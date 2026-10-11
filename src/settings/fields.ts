import type {
  CamouflageMode,
  Fingerprint,
  FragmentMode,
  GrpcMode,
  Language,
  ShadowsocksMethod,
  TlsFragmentPreset,
  TunnelTransport,
} from "../types/settings";

export const LANGUAGES: readonly Language[] = ["en", "fa"];
export const FRAGMENT_MODES: readonly FragmentMode[] = ["off", "low", "medium", "high", "severe", "custom"];
export const FRAGMENT_PACKETS = ["tlshello", "1-1", "1-2", "1-3", "1-5"] as const;
export const CAMOUFLAGE_MODES: readonly CamouflageMode[] = ["off", "static", "nginx", "reverse", "minimal"];
export const VLESS_FLOWS = ["", "xtls-rprx-vision"] as const;
export const SS_METHODS: readonly ShadowsocksMethod[] = ["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"];
export const TRANSPORTS: readonly TunnelTransport[] = ["ws", "grpc", "xhttp"];
export const GRPC_MODES: readonly GrpcMode[] = ["gun", "multi"];
export const TLS_FRAGMENTS: readonly TlsFragmentPreset[] = ["off", "shadowrocket", "happ"];
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
  { path: "passwordIsBootstrap", spec: { kind: "bool" } },
  { path: "seededAt", spec: { kind: "int", min: 0, max: 4_102_444_800_000 } },
  { path: "sessionSecret", spec: { kind: "str", maxLen: 512 } },
  { path: "language", spec: { kind: "enum", allowed: LANGUAGES } },
  { path: "debugLogging", spec: { kind: "bool" } },
  { path: "vlessEnabled", spec: { kind: "bool" } },
  { path: "vlessUuid", spec: { kind: "str", maxLen: 64 } },
  { path: "vlessFlow", spec: { kind: "enum", allowed: VLESS_FLOWS } },
  { path: "vlessPath", spec: { kind: "str", maxLen: 32, minLen: 1, pattern: PATH_TOKEN_RE } },
  { path: "trojanEnabled", spec: { kind: "bool" } },
  { path: "trojanPassword", spec: { kind: "custom" } },
  { path: "trojanPath", spec: { kind: "custom" } },
  { path: "ssEnabled", spec: { kind: "bool" } },
  { path: "ssMethod", spec: { kind: "enum", allowed: SS_METHODS } },
  { path: "ssTls", spec: { kind: "bool" } },
  { path: "transport", spec: { kind: "enum", allowed: TRANSPORTS } },
  { path: "grpcMode", spec: { kind: "enum", allowed: GRPC_MODES } },
  { path: "grpcUserAgent", spec: { kind: "str", maxLen: 256 } },
  { path: "tlsFragment", spec: { kind: "enum", allowed: TLS_FRAGMENTS } },
  { path: "zeroRtt", spec: { kind: "bool" } },
  { path: "randomPath", spec: { kind: "bool" } },
  { path: "earlyDataEnabled", spec: { kind: "bool" } },
  { path: "earlyDataMaxBytes", spec: { kind: "int", min: 0, max: 8192 } },
  { path: "defaultPort", spec: { kind: "custom" } },
  { path: "cdnPresets", spec: { kind: "custom" } },
  { path: "customEndpoints", spec: { kind: "custom" } },
  { path: "preferredLocal", spec: { kind: "bool" } },
  { path: "preferredCount", spec: { kind: "int", min: 1, max: 2000 } },
  { path: "preferredPort", spec: { kind: "custom" } },
  { path: "preferredRemoteUrl", spec: { kind: "custom" } },
  { path: "cdnHost", spec: { kind: "custom" } },
  { path: "cdnSni", spec: { kind: "custom" } },
  { path: "warpPresets", spec: { kind: "custom" } },
  { path: "warpCustomEndpoints", spec: { kind: "custom" } },
  { path: "nameTemplate", spec: { kind: "str", maxLen: 512 } },
  { path: "fingerprint", spec: { kind: "enum", allowed: FINGERPRINTS } },
  { path: "randomizeSniCase", spec: { kind: "bool" } },
  { path: "echEnabled", spec: { kind: "bool" } },
  { path: "echAuto", spec: { kind: "bool" } },
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
  { path: "proxyIps", spec: { kind: "strArray", maxItems: 64, pattern: HOST_TOKEN_RE } },
  { path: "proxyIpPoolUrl", spec: { kind: "custom" } },
  { path: "enableUdp53", spec: { kind: "bool" } },
  { path: "dohUpstream", spec: { kind: "custom" } },
  { path: "profileTitle", spec: { kind: "str", maxLen: 64, trim: true } },
  { path: "subName", spec: { kind: "custom" } },
  { path: "skipCertVerify", spec: { kind: "bool" } },
  { path: "subConverter.api", spec: { kind: "custom" } },
  { path: "subConverter.config", spec: { kind: "custom" } },
  { path: "subConverter.emoji", spec: { kind: "bool" } },
  { path: "subConverter.list", spec: { kind: "bool" } },
  { path: "subConverter.udp", spec: { kind: "bool" } },
  { path: "subConverter.xudp", spec: { kind: "bool" } },
  { path: "subConverter.tls13", spec: { kind: "bool" } },
  { path: "subConverter.appendType", spec: { kind: "bool" } },
  { path: "subConverter.sort", spec: { kind: "bool" } },
  { path: "subConverter.expand", spec: { kind: "bool" } },
  { path: "subUpdateIntervalHours", spec: { kind: "int", min: 1, max: 168 } },
  { path: "maxNodesPerFormat", spec: { kind: "int", min: 1, max: 2000 } },
  { path: "killSwitch", spec: { kind: "bool" } },
  { path: "allowedIps", spec: { kind: "custom" } },
  { path: "camouflage.mode", spec: { kind: "enum", allowed: CAMOUFLAGE_MODES } },
  { path: "camouflage.reverseUrl", spec: { kind: "custom" } },
  { path: "routingRules.bypassLan", spec: { kind: "bool" } },
  { path: "routingRules.blockAds", spec: { kind: "bool" } },
  { path: "routingRules.blockMalware", spec: { kind: "bool" } },
  { path: "routingRules.blockQuic", spec: { kind: "bool" } },
  { path: "routingRules.customBypass", spec: { kind: "custom" } },
  { path: "routingRules.customBlock", spec: { kind: "custom" } },
  { path: "telegram.enabled", spec: { kind: "bool" } },
  { path: "telegram.botToken", spec: { kind: "custom" } },
  { path: "telegram.chatId", spec: { kind: "custom" } },
  { path: "telegram.onSubscribe", spec: { kind: "bool" } },
  { path: "telegram.onSaveConfig", spec: { kind: "bool" } },
  { path: "telegram.onAdminLogin", spec: { kind: "bool" } },
  { path: "telegram.silent", spec: { kind: "bool" } },
  { path: "cf.email", spec: { kind: "custom" } },
  { path: "cf.globalApiKey", spec: { kind: "str", maxLen: 256 } },
  { path: "cf.accountId", spec: { kind: "str", maxLen: 64 } },
  { path: "cf.apiToken", spec: { kind: "str", maxLen: 256 } },
  { path: "cf.usageApiUrl", spec: { kind: "custom" } },
  { path: "cfUsage.success", spec: { kind: "bool" } },
  { path: "cfUsage.pages", spec: { kind: "int", min: 0, max: 9007199254740991 } },
  { path: "cfUsage.workers", spec: { kind: "int", min: 0, max: 9007199254740991 } },
  { path: "cfUsage.total", spec: { kind: "int", min: 0, max: 9007199254740991 } },
  { path: "cfUsage.max", spec: { kind: "int", min: 0, max: 9007199254740991 } },
  { path: "cfUsage.updatedAt", spec: { kind: "int", min: 0, max: 9007199254740991 } },
];
