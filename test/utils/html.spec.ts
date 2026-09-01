import { describe, expect, it } from "vitest";
import { escapeHtml } from "../../src/utils/html";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes each character individually", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b");
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("leaves safe text unchanged", () => {
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml("Hello-World_123")).toBe("Hello-World_123");
    expect(escapeHtml("متن فارسی")).toBe("متن فارسی");
  });

  it("escapes ampersands first so entities are not double-decoded", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });
});
