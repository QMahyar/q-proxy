export interface WarpAddresses {
  ipv4: string;
  ipv6: string;
}

export interface WarpConfig {
  private_key: string;
  public_key: string;
  addresses: WarpAddresses;
  peer_public_key: string;
  mtu: number;
  reserved: [number, number, number];
}

export type AmneziaValue = number | string;

export interface AmneziaParams {
  Jc?: AmneziaValue;
  Jmin?: AmneziaValue;
  Jmax?: AmneziaValue;
  S1?: AmneziaValue;
  S2?: AmneziaValue;
  S3?: AmneziaValue;
  S4?: AmneziaValue;
  H1?: AmneziaValue;
  H2?: AmneziaValue;
  H3?: AmneziaValue;
  H4?: AmneziaValue;
  I1?: string;
}

export interface WarpEndpoint {
  ip: string;
  port: number;
}

export interface WarpAccount {
  id: string;
  name: string;
  token: string;
  created_at: string;
  warp_id: string | null;
  warp_token: string | null;
  config: WarpConfig;
  endpoint_list:
    | { type: "preset"; preset_id: string }
    | { type: "custom"; custom_endpoints: WarpEndpoint[] };
  amnezia_overrides: AmneziaParams | null;
  dns: string | null;
}

export interface WarpPreset {
  id: string;
  name: string;
  endpoints: WarpEndpoint[];
  dns: string | null;
}

export interface WarpGlobalSettings {
  amnezia: AmneziaParams;
}

export interface SanitizedWarpAccount {
  id: string;
  name: string;
  token: string;
  created_at: string;
  config: Omit<WarpConfig, "private_key">;
  endpoint_list: WarpAccount["endpoint_list"];
  amnezia_overrides: AmneziaParams | null;
  dns: string | null;
}
