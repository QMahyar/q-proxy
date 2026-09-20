import { describe, expect, it } from "vitest";
import { validateSettings } from "../../src/settings/validate";

describe("custom CDN front host/SNI triple", () => {
  it("rejects non-hostname overrides and accepts empty plus valid domains", () => {
    expect(validateSettings({ cdnHost: "not a host!!" }).ok).toBe(false);
    expect(validateSettings({ cdnSni: "bad_host!" }).ok).toBe(false);
    const ok = validateSettings({ cdnHost: "front.example.com", cdnSni: "front.example.com" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.cdnHost).toBe("front.example.com");
      expect(ok.value.cdnSni).toBe("front.example.com");
    }
    const cleared = validateSettings({ cdnHost: "", cdnSni: "" });
    expect(cleared.ok).toBe(true);
  });
});
