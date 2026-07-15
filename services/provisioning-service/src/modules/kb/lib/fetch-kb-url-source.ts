// Server-side fetch for `url:` KB sources (SPEC.md decision 6), guarded by
// `@yoizen/shared`'s `validateOutboundUrl` (extracted from connector-runtime
// for this reuse — see that file's header). The guard runs BEFORE any
// network call is attempted; a rejected URL never reaches `fetchImpl`.
//
// KNOWN GAP (carried forward, not fixed here): `validateOutboundUrl` checks
// the literal hostname string only — no DNS resolution — so a public-looking
// hostname that resolves to a private/loopback address at fetch time (DNS
// rebinding) is not caught. This gap is MORE urgent here than at its
// original connector-invoke-api call site because every tenant-supplied KB
// `url:` source is now a server-side fetch target. See the Progress entry in
// manual-loops/declarative-provisioning.md for the explicit follow-up — this
// task does not fix it.
//
// `fetchImpl` is injected (defaults to the global `fetch`) so unit tests can
// assert the guard runs and can simulate fetch failures/oversized bodies
// without a real network call.

import { validateOutboundUrl } from "@yoizen/shared";
import { err, ok, type Result } from "../../../lib/result";
import type {
  ResolvedKbDocumentContent,
  ResolveKbSourceError,
} from "../domain/kb.interfaces";
import { computeSha256 } from "./compute-sha256";

export const KB_URL_SOURCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
const FETCH_TIMEOUT_MS = 15_000;

export type KbUrlFetch = (url: string) => Promise<Response>;

export async function fetchKbUrlSource(
  url: string,
  fetchImpl: KbUrlFetch = (u) =>
    fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
): Promise<Result<ResolvedKbDocumentContent, ResolveKbSourceError>> {
  const guard = validateOutboundUrl(url);
  if (!guard.ok) {
    return err({
      kind: "url_rejected",
      message: `KB url source rejected by SSRF guard: ${guard.error}`,
    });
  }

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    return err({
      kind: "url_fetch_failed",
      message: `KB url source fetch failed for '${url}': ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }

  if (!response.ok) {
    return err({
      kind: "url_fetch_failed",
      message: `KB url source fetch for '${url}' returned HTTP ${String(response.status)}`,
    });
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > KB_URL_SOURCE_MAX_BYTES) {
    return err({
      kind: "url_too_large",
      message: `KB url source '${url}' is ${String(bytes.length)} bytes, over the ${String(KB_URL_SOURCE_MAX_BYTES)}-byte cap`,
    });
  }

  return ok({ sha256: computeSha256(bytes), bytes, uploadMode: "text" });
}
