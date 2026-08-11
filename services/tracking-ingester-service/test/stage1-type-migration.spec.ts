import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "../src/lib/classify.js";
import { toTrackedEventRow } from "../src/lib/to-tracked-event-row.js";

/**
 * envelope-drift T05 ripple guard — stage-1 `type` migration.
 *
 * api-gateway used to stamp `io.yoizen.messaging.webhook.received.v1` on EVERY
 * stage-1 envelope; it now stamps the prescriptive per-channel
 * `io.yoizen.messaging.<channel>.webhook.webhook_received.v1`
 * (`services/api-gateway/src/modules/channels/webhook-ingress-type.ts`).
 *
 * Envelopes carrying the OLD value are already persisted in
 * `tracking.tracked_events` (see `golden/raw/INGRESS-ACME-seq1242.json` and
 * friends), so BOTH values must keep landing in the same bucket.
 *
 * They do, and this test pins WHY: the ingester classifies by SUBJECT, never
 * by `envelope.type`. `classify(subject, options)`
 * (`src/lib/classify.ts:160`) takes a subject string as its only input, and
 * every call site passes `msg.subject` — rule 2 matches on the subject's
 * producer/domain/provider/kind tokens (`classify.ts:196-204`), which this
 * change does not touch. Without this test the invariant is invisible and the
 * next reader could "helpfully" add a type-based branch.
 */

const FIXTURES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "fixtures",
  "bus-events"
);

const STAGE_1_SUBJECT =
  "evt.t1.api-gateway.messaging.telegram.webhook.webhook_received.v1";

/** The value every stage-1 envelope carried before 2026-07-31. */
const OLD_TYPE = "io.yoizen.messaging.webhook.received.v1";
/** What api-gateway stamps now, for channel `telegram`. */
const NEW_TYPE = "io.yoizen.messaging.telegram.webhook.webhook_received.v1";

function stage1Envelope(type: string): Record<string, unknown> {
  const fixture = JSON.parse(
    readFileSync(
      join(FIXTURES_DIR, "channel-service-webhook-ingress-envelope-01.json"),
      "utf8"
    )
  ) as Record<string, unknown>;
  return { ...fixture, type };
}

describe("stage-1 type migration (envelope-drift T05)", () => {
  it("the historical fixture still carries the old type", () => {
    // Guards the premise: if someone rewrites the fixture, this test stops
    // proving anything about historical rows and says so.
    const fixture = JSON.parse(
      readFileSync(
        join(FIXTURES_DIR, "channel-service-webhook-ingress-envelope-01.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(fixture["type"]).toBe(OLD_TYPE);
  });

  it("classifies the stage-1 subject by subject alone, not by type", () => {
    const result = classify(STAGE_1_SUBJECT);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.businessFn).toBe("ingress");
    expect(result.value.rule).toBe(2);
    expect(result.value.tech).toBe("telegram");
  });

  it("maps old-type and new-type envelopes to identical classifications", () => {
    const oldRow = toTrackedEventRow(STAGE_1_SUBJECT, stage1Envelope(OLD_TYPE));
    const newRow = toTrackedEventRow(STAGE_1_SUBJECT, stage1Envelope(NEW_TYPE));

    expect(oldRow.ok).toBe(true);
    expect(newRow.ok).toBe(true);
    if (!oldRow.ok || !newRow.ok) {
      return;
    }

    expect(newRow.value.tech).toBe(oldRow.value.tech);
    expect(newRow.value.business_fn).toBe(oldRow.value.business_fn);
    expect(newRow.value.rule).toBe(oldRow.value.rule);
    expect(newRow.value.compliance).toBe(oldRow.value.compliance);
    expect(newRow.value.consumed_by).toEqual(oldRow.value.consumed_by);
    expect(newRow.value.is_claim_check).toBe(oldRow.value.is_claim_check);

    // The stage-1 canonical-with-known-drift exception still applies to both
    // (absent `accountid` only) — the type change must not affect it.
    expect(newRow.value.business_fn).toBe("ingress");
    expect(newRow.value.compliance).toBe("partial");
  });

  it("persists each envelope's own type verbatim (no rewriting of history)", () => {
    const oldRow = toTrackedEventRow(STAGE_1_SUBJECT, stage1Envelope(OLD_TYPE));
    const newRow = toTrackedEventRow(STAGE_1_SUBJECT, stage1Envelope(NEW_TYPE));
    expect(oldRow.ok && newRow.ok).toBe(true);
    if (!oldRow.ok || !newRow.ok) {
      return;
    }

    // `GET /events?type=` filters on `envelope->>'type'`
    // (`src/lib/build-events-query.ts:282`), so the stored body must keep
    // whatever the producer sent — old rows stay queryable by the old value.
    const storedOld = oldRow.value.envelope as Record<string, unknown>;
    const storedNew = newRow.value.envelope as Record<string, unknown>;
    expect(storedOld["type"]).toBe(OLD_TYPE);
    expect(storedNew["type"]).toBe(NEW_TYPE);
  });
});
