export const SETTINGS_VERSION = 4;

export const CF_TLS_PORTS = [443, 2053, 2083, 2087, 2096, 8443] as const;
export const CF_PLAIN_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095] as const;

export type Language = "en" | "fa";
export type Fingerprint =
  | "chrome"
  | "firefox"
  | "safari"
  | "ios"
  | "android"
  | "edge"
  | "360"
  | "qq"
  | "random"
  | "randomized";
export type PlainPortPolicy = "always" | "workers-dev" | "never";
export type CamouflageMode = "off" | "static" | "nginx" | "reverse" | "minimal";
export type FragmentMode = "off" | "low" | "medium" | "high" | "severe" | "custom";

export interface FragmentSettings {
  mode: FragmentMode;
  packets: "tlshello" | "1-1" | "1-2" | "1-3" | "1-5";
  lengthMin: number;
  lengthMax: number;
  delayMin: number;
  delayMax: number;
  maxSplitMin: number;
  maxSplitMax: number;
}

export interface CamouflageSettings {
  mode: CamouflageMode;
  reverseUrl: string;
}

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
  onSubscribe: boolean;
  onSaveConfig: boolean;
  onAdminLogin: boolean;
  silent: boolean;
}

export interface CfSettings {
  email: string;
  globalApiKey: string;
  accountId: string;
  apiToken: string;
  usageApiUrl: string;
}

export interface CfUsageState {
  success: boolean;
  pages: number;
  workers: number;
  total: number;
  max: number;
  updatedAt: number;
}

export interface SubConverterSettings {
  api: string;
  config: string;
  emoji: boolean;
  list: boolean;
  udp: boolean;
  xudp: boolean;
  tls13: boolean;
  appendType: boolean;
  sort: boolean;
  expand: boolean;
}

export interface Settings {
  version: number;
  securePath: string;
  passwordHash: string | null;
  passwordSalt: string | null;
  passwordIsBootstrap: boolean;
  seededAt: number;
  sessionSecret: string;
  language: Language;
  debugLogging: boolean;
  vlessEnabled: boolean;
  vlessUuid: string;
  vlessFlow: string;
  vlessPath: string;
  earlyDataEnabled: boolean;
  earlyDataMaxBytes: number;
  cdnPresets: string[];
  customEndpoints: string[];
  preferredLocal: boolean;
  preferredCount: number;
  preferredPort: number;
  preferredRemoteUrl: string;
  cdnHost: string;
  cdnSni: string;
  warpPresets: string[];
  warpCustomEndpoints: string[];
  defaultPort: number;
  nameTemplate: string;
  fingerprint: Fingerprint;
  randomizeSniCase: boolean;
  alpn: string[];
  echEnabled: boolean;
  echAuto: boolean;
  echServerName: string;
  fragment: FragmentSettings;
  proxyIps: string[];
  proxyIpPoolUrl: string;
  enableUdp53: boolean;
  dohUpstream: string;
  profileTitle: string;
  subName: string;
  skipCertVerify: boolean;
  subConverter: SubConverterSettings;
  subUpdateIntervalHours: number;
  maxNodesPerFormat: number;
  killSwitch: boolean;
  allowedIps: string[];
  camouflage: CamouflageSettings;
  routingRules: RoutingRules;
  telegram: TelegramSettings;
  cf: CfSettings;
  cfUsage: CfUsageState | null;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  securePath: "",
  passwordHash: null,
  passwordSalt: null,
  passwordIsBootstrap: false,
  seededAt: 0,
  sessionSecret: "",
  language: "fa",
  debugLogging: false,
  vlessEnabled: true,
  vlessUuid: "",
  vlessFlow: "",
  vlessPath: "vl",
  earlyDataEnabled: true,
  earlyDataMaxBytes: 2048,
  cdnPresets: [],
  customEndpoints: [],
  preferredLocal: true,
  preferredCount: 16,
  preferredPort: -1,
  preferredRemoteUrl: "",
  cdnHost: "",
  cdnSni: "",
  warpPresets: ["default"],
  warpCustomEndpoints: [],
  defaultPort: 443,
  nameTemplate: "",
  fingerprint: "chrome",
  randomizeSniCase: true,
  alpn: ["http/1.1"],
  echEnabled: false,
  echAuto: false,
  echServerName: "",
  fragment: {
    mode: "off",
    packets: "tlshello",
    lengthMin: 100,
    lengthMax: 200,
    delayMin: 1,
    delayMax: 1,
    maxSplitMin: 2,
    maxSplitMax: 4,
  },
  proxyIps: [],
  proxyIpPoolUrl: "",
  enableUdp53: true,
  dohUpstream: "https://cloudflare-dns.com/dns-query",
  profileTitle: "Q Proxy",
  subName: "",
  skipCertVerify: false,
  subConverter: {
    api: "",
    config: "",
    emoji: false,
    list: false,
    udp: false,
    xudp: false,
    tls13: false,
    appendType: false,
    sort: false,
    expand: true,
  },
  subUpdateIntervalHours: 12,
  maxNodesPerFormat: 500,
  killSwitch: false,
  allowedIps: [],
  camouflage: { mode: "static", reverseUrl: "" },
  routingRules: { bypassLan: false, blockAds: false, blockMalware: false, blockQuic: false, customBypass: [], customBlock: [] },
  telegram: { enabled: false, botToken: "", chatId: "", onSubscribe: true, onSaveConfig: true, onAdminLogin: true, silent: false },
  cf: { email: "", globalApiKey: "", accountId: "", apiToken: "", usageApiUrl: "" },
  cfUsage: { success: false, pages: 0, workers: 0, total: 0, max: 0, updatedAt: 0 },
};

export const SENSITIVE_SETTING_PATHS = ["passwordHash", "passwordSalt", "sessionSecret"] as const;

export type PublicSettings = Omit<Settings, (typeof SENSITIVE_SETTING_PATHS)[number]> & {
  telegram: Omit<TelegramSettings, "botToken">;
  cf: Omit<CfSettings, "globalApiKey" | "apiToken">;
};

export interface RoutingRules {
  bypassLan: boolean;
  blockAds: boolean;
  blockMalware: boolean;
  blockQuic: boolean;
  customBypass: string[];
  customBlock: string[];
}
