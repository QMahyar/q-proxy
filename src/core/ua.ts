export type SubFormat = "base64" | "singbox" | "clash" | "xray";

const SINGBOX_TOKENS = ["sing-box", "singbox", "hiddify", "nekobox", "karing", "throne", "nekoray", "sfa", "sfi", "sfm", "sft"];
const CLASH_TOKENS = ["clash", "mihomo", "stash"];
const XRAY_TOKENS = ["xray-core"];
const BASE64_CLIENT_TOKENS = [
  "v2rayng",
  "v2rayn",
  "shadowrocket",
  "happ",
  "streisand",
  "v2box",
  "foxray",
  "husi",
  "napsternetv",
  "matsuri",
  "sagernet",
];

export function classifyUA(ua: string): SubFormat | "browser" {
  const s = ua.toLowerCase();
  if (s.length === 0) return "base64";
  if (containsAny(s, SINGBOX_TOKENS)) return "singbox";
  if (containsAny(s, CLASH_TOKENS)) return "clash";
  if (containsAny(s, XRAY_TOKENS)) return "xray";
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
