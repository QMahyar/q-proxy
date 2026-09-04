import { log } from "../core/log";
import { decodeBase64 } from "../utils/base64";
import { isLocalOrPrivateTarget } from "../utils/net";

const SCHEME_RE = /^(?:vless|vmess|trojan|ss|hysteria2?):\/\//;
const MAX_TOTAL_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5000;
const TOTAL_TIMEOUT_MS = 10000;

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

function capText(raw: string, cap: number): { text: string; used: number } {
  const encoded = new TextEncoder().encode(raw);
  let cut = Math.min(encoded.byteLength, Math.max(0, cap));
  while (cut > 0 && cut < encoded.byteLength && (encoded[cut]! & 0xc0) === 0x80) cut--;
  return { text: new TextDecoder().decode(encoded.subarray(0, cut)), used: cut };
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    return capText(await res.text(), cap).text;
  }
  const decoder = new TextDecoder();
  let text = "";
  let left = cap;
  for (;;) {
    if (left <= 0) {
      void reader.cancel().catch(() => {});
      break;
    }
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    const allow = Math.min(value.byteLength, left);
    text += decoder.decode(allow === value.byteLength ? value : value.subarray(0, allow), { stream: true });
    left -= allow;
    if (allow < value.byteLength) {
      void reader.cancel().catch(() => {});
      break;
    }
  }
  return text;
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      log.debug("merge", "remote sub skipped: invalid url", { url });
      return "";
    }
    if (isLocalOrPrivateTarget(parsed.hostname)) {
      log.debug("merge", "remote sub skipped: blocked host", { url });
      return "";
    }
    const res = await fetch(url, { signal, redirect: "follow" });
    try {
      const finalUrl = new URL(res.url);
      if (isLocalOrPrivateTarget(finalUrl.hostname)) {
        log.debug("merge", "remote sub skipped: redirected to blocked host", { url });
        return "";
      }
    } catch {}
    if (!res.ok) {
      log.debug("merge", "remote sub skipped: not ok", { url, status: res.status });
      return "";
    }
    return await readCapped(res, MAX_TOTAL_BYTES);
  } catch (err) {
    log.debug("merge", "remote sub fetch failed", { url, reason: String(err) });
    return "";
  }
}

function settleWithin(task: Promise<string>, ms: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gated = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), ms);
  });
  return Promise.race([task, gated]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
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

export async function fetchRemoteSubLines(
  urls: readonly string[],
  ttlSeconds = 0,
  timeouts: { perFetchMs?: number; totalMs?: number } = {},
): Promise<string[]> {
  if (urls.length === 0) return [];
  const key = urls.join("\n");
  const now = Date.now();
  if (ttlSeconds > 0 && remoteMemo !== null && remoteMemo.key === key && remoteMemo.expiresAt > now) {
    return remoteMemo.lines;
  }
  const perFetchMs = timeouts.perFetchMs ?? TIMEOUT_MS;
  const totalMs = timeouts.totalMs ?? TOTAL_TIMEOUT_MS;
  const controller = new AbortController();
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const totalElapsed = new Promise<void>((resolve) => {
    totalTimer = setTimeout(() => {
      controller.abort();
      resolve();
    }, totalMs);
  });
  const texts: string[] = urls.map(() => "");
  try {
    const tasks = urls.map((url, index) =>
      settleWithin(fetchText(url, controller.signal), perFetchMs).then((text) => {
        texts[index] = text;
      }),
    );
    await Promise.race([Promise.all(tasks), totalElapsed]);
  } finally {
    if (totalTimer !== undefined) clearTimeout(totalTimer);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  let left = MAX_TOTAL_BYTES;
  for (const raw of texts) {
    if (left <= 0) break;
    const capped = capText(raw, left);
    left -= capped.used;
    for (const line of extractLines(capped.text)) {
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
