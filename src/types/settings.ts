export const SETTINGS_VERSION = 1;

export const CF_TLS_PORTS = [443, 2053, 2083, 2087, 2096, 8443] as const;
export const CF_PLAIN_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095] as const;

export type Language = "en" | "fa";
export type SsMethod = "aes-128-gcm" | "aes-256-gcm";
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
export type CamouflageMode = "off" | "static" | "proxy";
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

export interface ChainProxySettings {
  enabled: boolean;
  uri: string;
}

export interface CamouflageSettings {
  mode: CamouflageMode;
  url: string;
}

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface Settings {
  version: number;
  securePath: string;
  passwordHash: string | null;
  passwordSalt: string | null;
  sessionSecret: string;
  language: Language;
  debugLogging: boolean;
  vlessEnabled: boolean;
  vmessEnabled: boolean;
  trojanEnabled: boolean;
  ssEnabled: boolean;
  vlessUuid: string;
  vmessUuid: string;
  trojanPassword: string;
  ssPassword: string;
  ssMethod: SsMethod;
  vlessPath: string;
  vmessPath: string;
  trojanPath: string;
  ssPath: string;
  earlyDataEnabled: boolean;
  earlyDataMaxBytes: number;
  hostnameOverride: string;
  customDomains: string[];
  cleanIps: string[];
  tlsPorts: number[];
  plainPorts: number[];
  plainPortPolicy: PlainPortPolicy;
  fingerprint: Fingerprint;
  randomizeSniCase: boolean;
  alpn: string[];
  echEnabled: boolean;
  echServerName: string;
  cdn: { enabled: boolean; addresses: string[]; host: string; sni: string };
  fragment: FragmentSettings;
  proxyIpMode: "proxyip" | "nat64";
  proxyIps: string[];
  nat64Prefixes: string[];
  chainProxy: ChainProxySettings;
  enableUdp53: boolean;
  dohUpstream: string;
  remoteDns: string;
  localDns: string;
  urlTestIntervalSec: number;
  profileTitle: string;
  subUpdateIntervalHours: number;
  maxNodesPerFormat: number;
  remoteSubUrls: string[];
  killSwitch: boolean;
  speedtestIntercept: boolean;
  camouflage: CamouflageSettings;
  routingRules: RoutingRules;
  telegram: TelegramSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  securePath: "",
  passwordHash: null,
  passwordSalt: null,
  sessionSecret: "",
  language: "fa",
  debugLogging: false,
  vlessEnabled: true,
  vmessEnabled: true,
  trojanEnabled: true,
  ssEnabled: true,
  vlessUuid: "",
  vmessUuid: "",
  trojanPassword: "",
  ssPassword: "",
  ssMethod: "aes-128-gcm",
  vlessPath: "vl",
  vmessPath: "vm",
  trojanPath: "tr",
  ssPath: "ss",
  earlyDataEnabled: true,
  earlyDataMaxBytes: 2048,
  hostnameOverride: "",
  customDomains: [],
  cleanIps: [],
  tlsPorts: [443, 2053, 2083, 2087, 2096, 8443],
  plainPorts: [80, 8080, 8880, 2052, 2082, 2086, 2095],
  plainPortPolicy: "workers-dev",
  fingerprint: "chrome",
  randomizeSniCase: true,
  alpn: ["http/1.1"],
  echEnabled: false,
  echServerName: "",
  cdn: { enabled: false, addresses: [], host: "", sni: "" },
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
  proxyIpMode: "proxyip",
  proxyIps: [],
  nat64Prefixes: ["[2a02:898:146:64::]", "[2602:fc59:b0:64::]", "[2602:fc59:11:64::]"],
  chainProxy: { enabled: false, uri: "" },
  enableUdp53: true,
  dohUpstream: "https://cloudflare-dns.com/dns-query",
  remoteDns: "https://8.8.8.8/dns-query",
  localDns: "localhost",
  urlTestIntervalSec: 300,
  profileTitle: "Q Proxy",
  subUpdateIntervalHours: 12,
  maxNodesPerFormat: 500,
  remoteSubUrls: [],
  killSwitch: false,
  speedtestIntercept: true,
  camouflage: { mode: "static", url: "" },
  routingRules: { bypassLan: false, blockAds: false, blockMalware: false, blockQuic: false, customBypass: [], customBlock: [] },
  telegram: { enabled: false, botToken: "", chatId: "" },
};

export const SENSITIVE_SETTING_PATHS = ["passwordHash", "passwordSalt", "sessionSecret"] as const;

export type PublicSettings = Omit<Settings, (typeof SENSITIVE_SETTING_PATHS)[number]> & {
  telegram: Omit<TelegramSettings, "botToken">;
};

export interface RoutingRules {
  bypassLan: boolean;
  blockAds: boolean;
  blockMalware: boolean;
  blockQuic: boolean;
  customBypass: string[];
  customBlock: string[];
}
