import { decodeBase64 } from "../utils/base64";
import { isLocalOrPrivateTarget } from "../utils/net";

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
    const encoded = new TextEncoder().encode(raw);
    let cut = Math.min(encoded.byteLength, Math.max(0, budget.left));
    while (cut > 0 && cut < encoded.byteLength && (encoded[cut]! & 0xc0) === 0x80) cut--;
    budget.left -= cut;
    return new TextDecoder().decode(encoded.subarray(0, cut));
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
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return [];
    }
    if (isLocalOrPrivateTarget(parsed.hostname)) return [];
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    try {
      const finalUrl = new URL(res.url);
      if (isLocalOrPrivateTarget(finalUrl.hostname)) return [];
    } catch {}
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
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    if (budget.left <= 0) break;
    const lines = await fetchOne(u, budget);
    for (const line of lines) {
      if (seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
  }
  if (ttlSeconds > 0) {
    const expiresAt = out.length > 0 ? now + ttlSeconds * 1000 : now + 60 * 1000;
    remoteMemo = { key, lines: out, expiresAt };
  }
  return out;
}
