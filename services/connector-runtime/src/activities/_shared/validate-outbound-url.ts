// SSRF guard shared by the webhook delivery activity (`webhook-delivery.ts`)
// and request validation (`parse-invoke-request-body.ts`). Mirrors the
// precedent already established in this same service — `validateUrl` in
// `mcp-call.activity.ts` (itself ported from `agent-ai-service`'s
// `webhook-action.service.ts`/`adapter-executor.service.ts`/
// `mcp-tools-probe.service.ts`) — but returns a `Result` instead of
// throwing a Temporal `ApplicationFailure`, so it is usable both at
// request-validation time (mapped onto a 400 response, no HTTP call ever
// attempted) and at delivery time (best-effort warn + skip, never throws;
// defense in depth for envelopes that crossed the broker).
//
// Rejects: non-http(s) schemes, localhost/`::1`, the cloud-metadata
// endpoint, link-local addresses, and RFC1918 private ranges. There is no
// `scope: "internal"` opt-in here (unlike `mcp-call.activity.ts`'s MCP
// server config) — webhook targets are always caller-supplied over the
// public invoke API, so private-range delivery is never allowed.

import { err, ok, type Result } from "../../lib/result";

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
