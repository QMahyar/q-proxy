import type { Settings } from "../../src/types/settings";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

export function makeTestSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    securePath: "mysecret1",
    vlessUuid: "11111111-2222-3333-4444-555555555555",
    vmessUuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    trojanPassword: "trojanpass123",
    ssPassword: "sspass123456",
    sessionSecret: "s".repeat(64),
    ...overrides,
  };
}
