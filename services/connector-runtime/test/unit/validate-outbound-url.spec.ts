import { describe, expect, it } from "bun:test";
import { validateOutboundUrl } from "../../src/activities/_shared/validate-outbound-url";

describe("validateOutboundUrl", () => {
  it("accepts a public https URL", () => {
    expect(validateOutboundUrl("https://caller.example/hook").ok).toBe(true);
  });

  it("accepts a public http URL", () => {
    expect(validateOutboundUrl("http://caller.example/hook").ok).toBe(true);
  });

  it("rejects an unparsable URL", () => {
    expect(validateOutboundUrl("not a url").ok).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateOutboundUrl("ftp://caller.example/hook").ok).toBe(false);
    expect(validateOutboundUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects localhost and loopback", () => {
    expect(validateOutboundUrl("http://localhost/hook").ok).toBe(false);
    expect(validateOutboundUrl("http://127.0.0.1/hook").ok).toBe(false);
    expect(validateOutboundUrl("http://[::1]/hook").ok).toBe(false);
  });

  it("rejects the cloud metadata endpoint", () => {
    expect(
      validateOutboundUrl("http://169.254.169.254/latest/meta-data").ok
    ).toBe(false);
  });

  it("rejects link-local addresses", () => {
    expect(validateOutboundUrl("http://169.254.1.1/hook").ok).toBe(false);
    expect(validateOutboundUrl("http://[fe80::1]/hook").ok).toBe(false);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(validateOutboundUrl("http://10.0.0.5/hook").ok).toBe(false);
    expect(validateOutboundUrl("http://172.16.0.5/hook").ok).toBe(false);
    expect(validateOutboundUrl("http://172.31.255.255/hook").ok).toBe(false);
    expect(validateOutboundUrl("http://192.168.1.1/hook").ok).toBe(false);
  });

  it("does not reject public IPs that merely start with a private octet", () => {
    // 172.15.x and 172.32.x are outside the 172.16.0.0/12 RFC1918 range.
    expect(validateOutboundUrl("http://172.15.0.1/hook").ok).toBe(true);
    expect(validateOutboundUrl("http://172.32.0.1/hook").ok).toBe(true);
  });
});
