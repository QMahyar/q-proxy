import { decodeBase64 } from "../utils/base64";

export const MAX_FOREIGN_SOURCES = 20;
export const MAX_FOREIGN_LINES = 200;

export interface ForeignInvalid {
  line: number;
  reason: string;
}

export interface ForeignSource {
  index: number;
  tag: string;
  endpoints: string[];
  invalid: ForeignInvalid[];
}

const BARE_LINE_RE = /^(?:\[([0-9a-fA-F:.]+)\]|([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?))(?::(\d{1,5}))?$/;
const B64_LINE_RE = /^[A-Za-z0-9+/_=-]{16,}$/;

function endpointOfVless(line: string): string | null {
  let url: URL;
  try {
    url = new URL(line);
  } catch {
    return null;
  }
  if (url.protocol !== "vless:") return null;
  const host = url.hostname;
  if (host.length === 0) return null;
  const port = url.port === "" ? 443 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const endpoint = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
  return endpoint;
}

function endpointOfBare(line: string): string | null {
  const m = BARE_LINE_RE.exec(line);
  if (m === null) return null;
  const host = m[1] !== undefined ? `[${m[1]}]` : m[2]!;
  const port = m[4] === undefined ? 443 : Number(m[4]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `${host}:${port}`;
}

function expandBase64(line: string): string[] | null {
  if (!B64_LINE_RE.test(line)) return null;
  const decoded = decodeBase64(line);
  if (!decoded.ok) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decoded.value);
  } catch {
    return null;
  }
  if (!text.includes("vless://") && !text.includes("\n") && !text.includes(":")) return null;
  return text.split("\n");
}

function parseLine(line: string): { endpoint: string } | { invalid: string } {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(line)) {
    if (!line.toLowerCase().startsWith("vless://")) {
      return { invalid: "only vless:// links can be imported" };
    }
    const endpoint = endpointOfVless(line);
    return endpoint === null ? { invalid: "not a valid vless link" } : { endpoint };
  }
  const expanded = expandBase64(line);
  if (expanded !== null) {
    const endpoints: string[] = [];
    for (const inner of expanded) {
      const trimmed = inner.trim();
      if (trimmed.length === 0) continue;
      const parsed = parseLine(trimmed);
      if ("endpoint" in parsed) endpoints.push(parsed.endpoint);
    }
    return endpoints.length > 0 ? { endpoint: endpoints.join("\n") } : { invalid: "base64 block holds no vless links" };
  }
  const bare = endpointOfBare(line);
  return bare === null ? { invalid: "not a host:port entry" } : { endpoint: bare };
}

function parseSource(block: string, index: number): ForeignSource | null {
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return null;
  const source: ForeignSource = { index, tag: `Source ${index + 1}`, endpoints: [], invalid: [] };
  const capped = lines.slice(0, MAX_FOREIGN_LINES);
  let truncated = lines.length > MAX_FOREIGN_LINES;
  for (let i = 0; i < capped.length; i++) {
    if (source.endpoints.length >= MAX_FOREIGN_LINES) {
      truncated = true;
      break;
    }
    let parsed: ReturnType<typeof parseLine>;
    try {
      parsed = parseLine(capped[i]!);
    } catch {
      parsed = { invalid: "unparseable line" };
    }
    if ("endpoint" in parsed) {
      for (const ep of parsed.endpoint.split("\n")) {
        if (source.endpoints.length >= MAX_FOREIGN_LINES) {
          truncated = true;
          break;
        }
        source.endpoints.push(ep);
      }
    } else {
      source.invalid.push({ line: i + 1, reason: parsed.invalid });
    }
  }
  if (truncated) {
    source.invalid.push({ line: MAX_FOREIGN_LINES + 1, reason: `source exceeds ${MAX_FOREIGN_LINES} lines` });
  }
  return source;
}

export function parseForeignLists(text: string): ForeignSource[] {
  try {
    const blocks = text.split(/\n\s*\n/).slice(0, MAX_FOREIGN_SOURCES);
    const out: ForeignSource[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const source = parseSource(blocks[i]!, i);
      if (source !== null) out.push(source);
    }
    return out;
  } catch {
    return [];
  }
}
