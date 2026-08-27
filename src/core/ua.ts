export type SubFormat = "base64" | "clash" | "singbox" | "surge" | "loon";

const CLASH_TOKENS = ["clash", "mihomo", "stash"];
const SINGBOX_TOKENS = ["sing-box", "singbox", "hiddify", "nekobox", "karing", "sfa", "sfi", "sfm", "sft"];
const SURGE_TOKENS = ["surge"];
const LOON_TOKENS = ["loon"];
const BASE64_CLIENT_TOKENS = [
  "v2rayng",
  "shadowrocket",
  "happ",
  "streisand",
  "v2box",
  "foxray",
  "husi",
  "xray",
  "napsternetv",
];

export function classifyUA(ua: string): SubFormat | "browser" {
  const s = ua.toLowerCase();
  if (s.length === 0) return "base64";
  if (containsAny(s, CLASH_TOKENS)) return "clash";
  if (containsAny(s, SINGBOX_TOKENS)) return "singbox";
  if (containsAny(s, SURGE_TOKENS)) return "surge";
  if (containsAny(s, LOON_TOKENS)) return "loon";
  if (containsAny(s, BASE64_CLIENT_TOKENS)) return "base64";
  if (s.startsWith("mozilla/") || s.includes("chrome/") || s.includes("safari/") || s.includes("firefox/")) {
    return "browser";
  }
  return "base64";
}

function containsAny(haystack: string, needles: string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true;
  }
  return false;
}
