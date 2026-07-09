// `is_claim_check` facet — TAXONOMY.md §6. Boolean, orthogonal to `tech`/
// `business_fn`. A slim claim-check envelope carries the payload out-of-band in
// the Object Store; the flag is derived purely from the envelope body.
// Pure function, no side effects.
//
// Detection (TAXONOMY.md §6): `envelope.data.payload_inline === false` (with
// `payload_ref` populated and `payload: null`). See docs/messaging/claim-check.md
// §5-7 and packages/database/src/claim-check.ts (`looksLikeClaimCheck`). The
// `payload_inline === false` check is the single sufficient signal.

import type { EventEnvelope } from "@yoizen/shared";
import { err, ok, type Result } from "./result.js";

/**
 * Returns `true` iff the envelope is a slim claim-check envelope
 * (`data.payload_inline === false`), per TAXONOMY.md §6. Canonical envelopes
 * with an inline payload — and non-canonical envelopes that carry no `data`
 * block (e.g. GatewayAuditEvent) — are `ok(false)`: they are simply not
 * claim-check envelopes. Only a non-object input is an expected failure.
 */
export function isClaimCheck(envelope: EventEnvelope): Result<boolean> {
  if (envelope === null || typeof envelope !== "object") {
    return err("envelope must be an object");
  }

  // Read defensively: non-canonical envelopes may omit `data` entirely, which
  // is not `payload_inline === false` and therefore not a claim check.
  const data = (envelope as { data?: { payload_inline?: unknown } }).data;

  return ok(data?.payload_inline === false);
}
