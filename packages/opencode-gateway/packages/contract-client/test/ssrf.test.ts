import { describe, expect, test } from "bun:test";
import {
  assertHostResolvesPublic,
  checkUrlAllowed,
  denyReasonForUrl,
  isBlockedHost,
  isBlockedIp,
} from "../src/ssrf.js";

describe("SSRF blocklist", () => {
  test("isBlockedIp blocks the mission list", () => {
    // 127/8 loopback
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.1.2.3")).toBe(true);
    // 10/8
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("10.255.255.255")).toBe(true);
    // 192.168/16
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    // 169.254/16 metadata
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    // ::1 loopback, unspecified, unique-local
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd00::5")).toBe(true);
    // 0.0.0.0 unspecified
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    // Public addresses pass
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  test("isBlockedIp blocks encoded literals (dword/hex/octal/shortened)", () => {
    expect(isBlockedIp("2130706433")).toBe(true); // 127.0.0.1 dword
    expect(isBlockedIp("0x7f000001")).toBe(true); // 127.0.0.1 hex dword
    expect(isBlockedIp("0x7f.0x0.0x0.0x1")).toBe(true);
    expect(isBlockedIp("0177.0.0.01")).toBe(true); // octal quads
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true); // v4-mapped
    expect(isBlockedIp("2852030506")).toBe(true); // 169.254.169.254 dword
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  test("isBlockedHost blocks localhost + literals, passes DNS names", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("LOCALHOST")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("10.1.2.3")).toBe(true);
    expect(isBlockedHost("2130706433")).toBe(true);
    expect(isBlockedHost("")).toBe(true);
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("searxng")).toBe(false);
  });

  test("denyReasonForUrl is fail-closed", () => {
    expect(denyReasonForUrl("http://169.254.169.254/")).toContain("not globally routable");
    expect(denyReasonForUrl("http://127.0.0.1:8000/x")).toContain("not globally routable");
    expect(denyReasonForUrl("ftp://example.com/x")).toContain("unsupported scheme");
    expect(denyReasonForUrl("http://localhost/")).toContain("localhost");
    expect(denyReasonForUrl("http://example.com\\@127.0.0.1/")).toContain("forbidden characters");
    expect(denyReasonForUrl("not a url")).toContain("fail-closed");
    expect(denyReasonForUrl(`https://example.com/${"a".repeat(2100)}`)).toContain("longer than");
    // DNS names pass the literal layer (DNS pin decides next).
    expect(denyReasonForUrl("https://example.com/page")).toBeNull();
  });

  test("DNS pin denies private resolutions, fails closed on NXDOMAIN", async () => {
    const private_: (h: string) => Promise<string[]> = async () => ["10.1.2.3"];
    expect(await assertHostResolvesPublic("internal.example", private_)).toContain("non-routable");
    const empty = async () => [] as string[];
    expect(await assertHostResolvesPublic("nx.example", empty)).toContain("unresolvable");
    const boom = async () => { throw new Error("dns down"); };
    expect(await assertHostResolvesPublic("example.com", boom)).toContain("fail-closed");
    const pub = async () => ["93.184.216.34"];
    expect(await assertHostResolvesPublic("example.com", pub)).toBeNull();
  });

  test("checkUrlAllowed combines literal + DNS layers", async () => {
    const pub = async () => ["93.184.216.34"];
    expect(await checkUrlAllowed("https://example.com/page", pub)).toBeNull();
    expect(await checkUrlAllowed("http://127.0.0.1/", pub)).not.toBeNull();
    const priv = async () => ["192.168.1.10"];
    expect(await checkUrlAllowed("https://example.com/", priv)).toContain("non-routable");
  });
});
