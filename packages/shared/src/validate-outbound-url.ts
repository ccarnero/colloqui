// Shared SSRF guard for server-side outbound fetches. Extracted from
// `connector-runtime`'s `validateOutboundUrl` (mirrors the precedent already
// established there — `validateUrl` in `mcp-call.activity.ts`, itself ported
// from `agent-ai-service`'s `webhook-action.service.ts`/
// `adapter-executor.service.ts`/`mcp-tools-probe.service.ts`) so every
// service that performs a server-side fetch of a caller-supplied URL shares
// ONE guard instead of re-implementing the same checks (manual-loops/
// declarative-provisioning.md, task T06 — reused by the KB `url:` source
// fetch, connector-runtime keeps re-exporting from here for its own webhook
// delivery + invoke-request-validation call sites).
//
// Rejects: non-http(s) schemes, localhost/`::1`, the cloud-metadata
// endpoint, link-local addresses, and RFC1918 private ranges.
//
// KNOWN GAP (carried forward, not fixed here): hostname checks run against
// the LITERAL hostname string only — there is no DNS resolution step, so a
// public-looking hostname that resolves to a private/loopback/metadata
// address at fetch time (DNS rebinding) is NOT caught. Flagged originally in
// `manual-loops/connector-invoke-api.md`; T06's server-side KB `url:` fetch
// makes this gap MORE urgent (every tenant-supplied KB url is now a
// server-side fetch target) — see the Progress entry in
// `manual-loops/declarative-provisioning.md` for the explicit follow-up.

import { err, ok, type Result } from "./lib/result";

export function validateOutboundUrl(url: string): Result<void, string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(`invalid URL: '${url}'`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err(`URL must use http or https protocol: '${url}'`);
  }

  // Bun's `URL#hostname` keeps the brackets for IPv6 literals (unlike the
  // WHATWG spec's bracket-free `hostname`); strip them so the IPv6 literal
  // checks below match regardless of runtime.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return err(`URL must not target localhost: '${url}'`);
  }

  if (hostname === "169.254.169.254") {
    return err(`URL must not target cloud metadata endpoint: '${url}'`);
  }

  if (hostname.startsWith("169.254.") || hostname.startsWith("fe80:")) {
    return err(`URL must not target link-local addresses: '${url}'`);
  }

  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number);
    if (
      octets[0] === 127 ||
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    ) {
      return err(`URL must not target private/RFC1918 addresses: '${url}'`);
    }
  }

  return ok(undefined);
}
