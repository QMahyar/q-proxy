import { describe, expect, it } from "vitest";
import { parseChainUri } from "../../../src/tunnel/chain";

describe("parseChainUri", () => {
  it("parses socks5 URIs with credentials and explicit ports", () => {
    const d = parseChainUri("socks5://user:secret@1.2.3.4:1080");
    expect(d).not.toBeNull();
    expect(d!).toEqual({
      kind: "socks5",
      host: "1.2.3.4",
      port: 1080,
      username: "user",
      password: "secret",
    });
  });

  it("treats socks:// as socks5 and applies scheme default ports", () => {
    const socks = parseChainUri("socks://plain.example");
    expect(socks).toMatchObject({ kind: "socks5", host: "plain.example", port: 1080 });
    expect(parseChainUri("http://proxy.example")).toMatchObject({ kind: "http", port: 80 });
  });

  it("rejects https:// URIs instead of dialing plaintext CONNECT", () => {
    expect(parseChainUri("https://proxy.example")).toBeNull();
    expect(parseChainUri("HTTPS://proxy.example:443")).toBeNull();
  });

  it("defaults missing passwords but keeps usernames", () => {
    const d = parseChainUri("socks5://lonely@h.example");
    expect(d!.username).toBe("lonely");
    expect(d!.password).toBeNull();
  });

  it("percent-decodes userinfo defensively", () => {
    const d = parseChainUri("http://%75ser:p%40ss@h.example");
    expect(d!.username).toBe("user");
    expect(d!.password).toBe("p@ss");
  });

  it("supports bracketed IPv6 hosts", () => {
    const d = parseChainUri("socks5://[2001:db8::1]:1080");
    expect(d!.host).toBe("2001:db8::1");
    expect(d!.port).toBe(1080);
  });

  it("rejects malformed input", () => {
    expect(parseChainUri("")).toBeNull();
    expect(parseChainUri("   ")).toBeNull();
    expect(parseChainUri("ftp://host")).toBeNull();
    expect(parseChainUri("socks5://")).toBeNull();
    expect(parseChainUri("socks5://h:1080/extra/path")).toBeNull();
    expect(parseChainUri("//no-scheme.example")).toBeNull();
  });
});
