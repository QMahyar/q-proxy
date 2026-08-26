import { decodeBase64 } from "../utils/base64";

const SCHEME_RE = /^(?:vless|vmess|trojan|ss|hysteria2?):\/\//;
const MAX_TOTAL_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5000;

function isSubLine(line: string): boolean {
  return line.length > 0 && SCHEME_RE.test(line);
}

function extractLines(raw: string): string[] {
  const text = raw.trim();
  if (text.length === 0) return [];
  if (isSubLine(text)) return text.split(/\r?\n/).map((l) => l.trim()).filter(isSubLine);
  const decoded = decodeBase64(text);
  if (!decoded.ok) return [];
  const plain = new TextDecoder().decode(decoded.value).trim();
  if (!isSubLine(plain)) return [];
  return plain.split(/\r?\n/).map((l) => l.trim()).filter(isSubLine);
}

async function readCapped(res: Response, budget: { left: number }): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const raw = await res.text();
    const allowed = raw.slice(0, Math.max(0, budget.left));
    budget.left -= allowed.length;
    return allowed;
  }
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    if (budget.left <= 0) {
      void reader.cancel().catch(() => {});
      break;
    }
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    const allow = Math.min(value.byteLength, budget.left);
    text += decoder.decode(allow === value.byteLength ? value : value.subarray(0, allow), { stream: true });
    budget.left -= allow;
    if (allow < value.byteLength) {
      void reader.cancel().catch(() => {});
      break;
    }
  }
  return text;
}

async function fetchOne(url: string, budget: { left: number }): Promise<string[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    if (!res.ok || budget.left <= 0) return [];
    const text = await readCapped(res, budget);
    return extractLines(text);
  } catch {
    return [];
  }
}

interface RemoteMemo {
  key: string;
  lines: string[];
  expiresAt: number;
}

let remoteMemo: RemoteMemo | null = null;

export function clearRemoteSubCache(): void {
  remoteMemo = null;
}

export async function fetchRemoteSubLines(urls: readonly string[], ttlSeconds = 0): Promise<string[]> {
  if (urls.length === 0) return [];
  const key = urls.join("\n");
  const now = Date.now();
  if (ttlSeconds > 0 && remoteMemo !== null && remoteMemo.key === key && remoteMemo.expiresAt > now) {
    return remoteMemo.lines;
  }
  const budget = { left: MAX_TOTAL_BYTES };
  const settled = await Promise.all(urls.map((u) => fetchOne(u, budget)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lines of settled) {
    for (const line of lines) {
      if (seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
  }
  if (ttlSeconds > 0) remoteMemo = { key, lines: out, expiresAt: now + ttlSeconds * 1000 };
  return out;
}
