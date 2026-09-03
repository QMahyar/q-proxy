import type {
  CamouflageMode,
  Fingerprint,
  FragmentMode,
  Language,
  SsMethod,
} from "../types/settings";

export const LANGUAGES: readonly Language[] = ["en", "fa"];
export const SS_METHODS: readonly SsMethod[] = ["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"];
export const FRAGMENT_MODES: readonly FragmentMode[] = ["off", "low", "medium", "high", "severe", "custom"];
export const FRAGMENT_PACKETS = ["tlshello", "1-1", "1-2", "1-3", "1-5"] as const;
export const CAMOUFLAGE_MODES: readonly CamouflageMode[] = ["off", "static", "proxy"];
export const PROXY_IP_MODES = ["proxyip", "nat64"] as const;
export const FINGERPRINTS: readonly Fingerprint[] = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
  "randomized",
];

export const SECURE_PATH_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const PATH_TOKEN_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const HOST_TOKEN_RE = /^[A-Za-z0-9._:-]{1,253}$/;
export const NAT64_PREFIX_RE = /^[0-9A-Fa-f:\[\]\/]{2,50}$/;

export type SettingFieldSpec =
  | { kind: "bool" }
  | { kind: "int"; min: number; max: number }
  | { kind: "str"; maxLen: number; minLen?: number; pattern?: RegExp; trim?: boolean }
  | { kind: "enum"; allowed: readonly string[] }
  | { kind: "nullableStr"; maxLen: number }
  | {
      kind: "strArray";
      maxItems: number;
      itemMaxLen?: number;
      pattern?: RegExp;
      lowerCase?: boolean;
    }
  | { kind: "urlList"; maxItems: number }
  | { kind: "custom" };

export interface SettingFieldDescriptor {
  path: string;
  spec: SettingFieldSpec;
}

export const SETTING_FIELD_DESCRIPTORS: readonly SettingFieldDescriptor[] = [
  { path: "securePath", spec: { kind: "str", maxLen: 64, minLen: 1, pattern: SECURE_PATH_RE } },
  { path: "passwordHash", spec: { kind: "nullableStr", maxLen: 512 } },
  { path: "passwordSalt", spec: { kind: "nullableStr", maxLen: 128 } },
  { path: "sessionSecret", spec: { kind: "str", maxLen: 512 } },
  { path: "language", spec: { kind: "enum", allowed: LANGUAGES } },
  { path: "debugLogging", spec: { kind: "bool" } },
  { path: "vlessEnabled", spec: { kind: "bool" } },
  { path: "vmessEnabled", spec: { kind: "bool" } },
  { path: "trojanEnabled", spec: { kind: "bool" } },
  { path: "ssEnabled", spec: { kind: "bool" } },
  { path: "vlessUuid", spec: { kind: "str", maxLen: 64 } },
  { path: "vmessUuid", spec: { kind: "str", maxLen: 64 } },
  { path: "trojanPassword", spec: { kind: "str", maxLen: 128 } },
  { path: "ssPassword", spec: { kind: "str", maxLen: 128 } },
  { path: "ssMethod", spec: { kind: "enum", allowed: SS_METHODS } },
  { path: "vlessPath", spec: { kind: "str", maxLen: 32, minLen: 1, pattern: PATH_TOKEN_RE } },
  { path: "vmessPath", spec: { kind: "str", maxLen: 32, minLen: 1, pattern: PATH_TOKEN_RE } },
  { path: "trojanPath", spec: { kind: "str", maxLen: 32, minLen: 1, pattern: PATH_TOKEN_RE } },
  { path: "ssPath", spec: { kind: "str", maxLen: 32, minLen: 1, pattern: PATH_TOKEN_RE } },
  { path: "earlyDataEnabled", spec: { kind: "bool" } },
  { path: "earlyDataMaxBytes", spec: { kind: "int", min: 0, max: 8192 } },
  { path: "addresses", spec: { kind: "custom" } },
  { path: "defaultPort", spec: { kind: "custom" } },
  { path: "nameTemplate", spec: { kind: "str", maxLen: 512 } },
  { path: "fingerprint", spec: { kind: "enum", allowed: FINGERPRINTS } },
  { path: "randomizeSniCase", spec: { kind: "bool" } },
  { path: "echEnabled", spec: { kind: "bool" } },
  { path: "echServerName", spec: { kind: "custom" } },
  { path: "alpn", spec: { kind: "custom" } },
  { path: "fragment.mode", spec: { kind: "enum", allowed: FRAGMENT_MODES } },
  { path: "fragment.packets", spec: { kind: "enum", allowed: FRAGMENT_PACKETS } },
  { path: "fragment.lengthMin", spec: { kind: "int", min: 1, max: 1500 } },
  { path: "fragment.lengthMax", spec: { kind: "int", min: 1, max: 1500 } },
  { path: "fragment.delayMin", spec: { kind: "int", min: 0, max: 10_000 } },
  { path: "fragment.delayMax", spec: { kind: "int", min: 0, max: 10_000 } },
  { path: "fragment.maxSplitMin", spec: { kind: "int", min: 1, max: 100 } },
  { path: "fragment.maxSplitMax", spec: { kind: "int", min: 1, max: 100 } },
  { path: "proxyIpMode", spec: { kind: "enum", allowed: PROXY_IP_MODES } },
  { path: "proxyIps", spec: { kind: "strArray", maxItems: 64, pattern: HOST_TOKEN_RE } },
  { path: "proxyIpPoolUrl", spec: { kind: "custom" } },
  {
    path: "nat64Prefixes",
    spec: { kind: "strArray", maxItems: 8, itemMaxLen: 50, pattern: NAT64_PREFIX_RE },
  },
  { path: "chainProxy.enabled", spec: { kind: "bool" } },
  { path: "chainProxy.uri", spec: { kind: "custom" } },
  { path: "enableUdp53", spec: { kind: "bool" } },
  { path: "dohUpstream", spec: { kind: "custom" } },
  { path: "remoteDns", spec: { kind: "custom" } },
  { path: "localDns", spec: { kind: "custom" } },
  { path: "urlTestIntervalSec", spec: { kind: "int", min: 60, max: 86_400 } },
  { path: "profileTitle", spec: { kind: "str", maxLen: 64, trim: true } },
  { path: "subUpdateIntervalHours", spec: { kind: "int", min: 1, max: 168 } },
  { path: "maxNodesPerFormat", spec: { kind: "int", min: 1, max: 2000 } },
  { path: "remoteSubUrls", spec: { kind: "urlList", maxItems: 16 } },
  { path: "sourceUrls", spec: { kind: "urlList", maxItems: 16 } },
  { path: "killSwitch", spec: { kind: "bool" } },
  { path: "speedtestIntercept", spec: { kind: "bool" } },
  { path: "camouflage.mode", spec: { kind: "enum", allowed: CAMOUFLAGE_MODES } },
  { path: "camouflage.url", spec: { kind: "custom" } },
  { path: "routingRules.bypassLan", spec: { kind: "bool" } },
  { path: "routingRules.blockAds", spec: { kind: "bool" } },
  { path: "routingRules.blockMalware", spec: { kind: "bool" } },
  { path: "routingRules.blockQuic", spec: { kind: "bool" } },
  { path: "routingRules.customBypass", spec: { kind: "custom" } },
  { path: "routingRules.customBlock", spec: { kind: "custom" } },
  { path: "telegram.enabled", spec: { kind: "bool" } },
  { path: "telegram.botToken", spec: { kind: "custom" } },
  { path: "telegram.chatId", spec: { kind: "custom" } },
];
