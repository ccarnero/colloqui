import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { processTrackedMessage } from "../src/lib/process-tracked-message.js";

const FIXTURES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "fixtures",
  "bus-events"
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

describe("processTrackedMessage — outcome derivation", () => {
  // Regression (T02b objection 1): a rule-19 workflow-service subject with a
  // compliant envelope must be `canonical`, NOT `unknown`. The previous
  // `rule >= 16` test mis-flagged rule 19 as unknown, firing a spurious alarm.
  // Only the UNKNOWN_RULES set (16/17/18) is the alarm (TAXONOMY.md §3/§4).
  it("classifies a rule-19 workflow-service envelope as canonical (not unknown)", () => {
    const result = processTrackedMessage({
      subject:
        "evt.acme.workflow-service.workflow.internal.native.execution_completed.v1",
      streamName: "INGRESS-ACME",
      streamSequence: 5,
      // Any compliant EventEnvelope body — classification is subject-driven.
      payload: loadFixture("audit-service-channel-envelope-01.json"),
      decoded: true,
      receivedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(result.row.rule).toBe(19);
    expect(result.outcome).toBe("canonical");
  });

  it("flags a rule-17 unrecognized 8-token envelope as unknown", () => {
    const result = processTrackedMessage({
      subject:
        "evt.tenant-a.mystery-producer.mystery.weirdchan.prov.mysterykind.v1",
      streamName: "INGRESS-TENANT-A",
      streamSequence: 9,
      payload: loadFixture("audit-service-channel-envelope-01.json"),
      decoded: true,
      receivedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(result.row.rule).toBe(17);
    expect(result.outcome).toBe("unknown");
  });

  // 'none' compliance coverage (T04b reviewer B objection 2). The two row-
  // producing paths that persist a non-envelope body MUST stamp compliance
  // "none", mirroring the "full"/"partial" assertions in to-tracked-event-row.
  it("stamps a non_envelope_family row (rule 14 audit.gateway) compliance none", () => {
    const result = processTrackedMessage({
      subject: "audit.gateway.request",
      streamName: "GATEWAY_AUDIT",
      streamSequence: 41_771,
      // A well-formed non-envelope family body (NOT an EventEnvelope).
      payload: loadFixture("api-gateway-gateway-audit-event-01.json"),
      decoded: true,
      receivedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(result.outcome).toBe("non_envelope");
    expect(result.row.rule).toBe(14);
    // The non-envelope subset the corrective SQL backfill targets: NULL
    // correlation_id, compliance "none".
    expect(result.row.compliance).toBe("none");
    expect(result.row.correlation_id).toBeNull();
  });

  it("stamps a rule-18 drift row (undecodable body) compliance none", () => {
    const result = processTrackedMessage({
      subject: "evt.acme.channel-service.messaging.whatsapp.meta.received.v1",
      streamName: "INGRESS-ACME",
      streamSequence: 7,
      payload: "<<not-json>>",
      decoded: false,
      receivedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(result.outcome).toBe("malformed");
    expect(result.row.rule).toBe(18);
    expect(result.row.compliance).toBe("none");
    expect(result.row.correlation_id).toBeNull();
  });
});
