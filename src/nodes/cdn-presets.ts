// Shipped CDN endpoint presets (constitution Principle IV exception to the
// no-hard-coded-addresses invariant: this file is the ONLY place in src/
// outside tests where literal generation addresses may appear).
// Entries are opt-in: generation consumes only ids listed in
// Settings.cdnPresets. Ids are stable forever (stored admin blobs reference
// them); unknown ids at generation time are ignored, never errors.

export interface CdnPreset {
  id: string;
  label: string;
  ip: string;
  port: number;
}

export const CDN_PRESETS: readonly CdnPreset[] = [
  { id: "cf-443-a", label: "CF 104.17.0.0:443", ip: "104.17.0.0", port: 443 },
  { id: "cf-443-b", label: "CF 104.18.0.0:443", ip: "104.18.0.0", port: 443 },
  { id: "cf-443-c", label: "CF 104.19.0.0:443", ip: "104.19.0.0", port: 443 },
  { id: "cf-2053-a", label: "CF 104.21.0.0:2053", ip: "104.21.0.0", port: 2053 },
  { id: "cf-2083-a", label: "CF 172.64.32.1:2083", ip: "172.64.32.1", port: 2083 },
  { id: "cf-2096-a", label: "CF 188.114.96.1:2096", ip: "188.114.96.1", port: 2096 },
  { id: "cf-80-a", label: "CF 104.17.0.0:80", ip: "104.17.0.0", port: 80 },
  { id: "cf-8080-a", label: "CF 172.64.32.1:8080", ip: "172.64.32.1", port: 8080 },
];
