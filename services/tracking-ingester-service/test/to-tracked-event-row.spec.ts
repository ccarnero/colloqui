import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCompliantEnvelope } from "@yoizen/shared";
import { toTrackedEventRow } from "../src/lib/to-tracked-event-row.js";

// Repo root is three levels up from services/tracking-ingester-service/test.
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

// Every fixture in fixtures/bus-events/, paired with the NATS delivery subject
// it would arrive on. `streamName` is supplied where it changes classification
// (the DLQ fixture is the same body as ingress-01 but delivered from DLQ-*).
interface FixtureCase {
  file: string;
  subject: string;
  streamName?: string;
}

const FIXTURES: FixtureCase[] = [
  {
    file: "api-gateway-gateway-audit-event-01.json",
    subject: "audit.gateway.request",
  },
  {
    file: "audit-service-channel-envelope-01.json",
    subject: "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1",
  },
  {
    file: "audit-service-execution-envelope-01.json",
    subject:
      "evt.tenant-a.ai-agent-gateway.automation.platform.internal.execution_completed.v1",
  },
  {
    file: "channel-service-webhook-ingress-envelope-01.json",
    subject:
      "evt.t1.api-gateway.messaging.whatsapp.webhook.webhook_received.v1",
  },
  {
    file: "usage-aggregator-envelope-parser-ingress-01.json",
    subject: "evt.tenant-1.channel-service.messaging.whatsapp.meta.received.v1",
  },
  {
    file: "usage-aggregator-envelope-parser-egress-02.json",
    subject: "evt.tenant-1.channel-service.messaging.whatsapp.meta.sent.v1",
  },
  {
    file: "usage-aggregator-envelope-parser-dlq-03.json",
    subject:
      "dlq.tenant-1.evt.tenant-1.channel-service.messaging.whatsapp.meta.received.v1",
    streamName: "DLQ-tenant-1",
  },
];

describe("toTrackedEventRow — every fixture in fixtures/bus-events/", () => {
  for (const fx of FIXTURES) {
    it(`maps or rejects ${fx.file} consistently with isCompliantEnvelope`, () => {
      const envelope = loadFixture(fx.file);
      const result = toTrackedEventRow(fx.subject, envelope, {
        streamName: fx.streamName,
      });

      if (isCompliantEnvelope(envelope)) {
        // A compliant envelope must produce a row.
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.subject).toBe(fx.subject);
          expect(result.value.event_id).toBe(envelope.id);
          expect(result.value.compliance).toBe("full");
        }
      } else if (result.ok) {
        // STAGE-1 INGRESS EXCEPTION (canonical-with-known-drift): a stage-1
        // `webhook_received` envelope failing compliance ONLY because accountid
        // is absent maps to a canonical row tagged compliance "partial", with a
        // real (non-synthesized) event_id.
        expect(result.value.compliance).toBe("partial");
        expect(result.value.event_id).toBe((envelope as { id: string }).id);
      } else {
        // Non-canonical / non-envelope inputs are rejected with a routable
        // discriminant, never thrown (SPEC.md T04).
        expect(["non_envelope_family", "malformed_envelope"]).toContain(
          result.error.kind
        );
      }
    });
  }

  it("rejects the GATEWAY_AUDIT fixture with a routable non_envelope_family discriminant (rule 14)", () => {
    // TAXONOMY.md §4 rule 14 + golden/labeled.tsv rows 72-73: the cross-tenant
    // audit.gateway.request stream is TRACKED (tech gateway-audit / business_fn
    // audit), so its rejection here MUST carry the routable discriminant T07
    // consumes — never a generic "not compliant" string.
    const envelope = loadFixture("api-gateway-gateway-audit-event-01.json");
    expect(isCompliantEnvelope(envelope)).toBe(false);

    const result = toTrackedEventRow("audit.gateway.request", envelope);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toEqual({
      kind: "non_envelope_family",
      rule: 14,
      tech: "gateway-audit",
      business_fn: "audit",
    });
  });

  it("only audit-service-channel-envelope-01 is a compliant envelope", () => {
    const compliant = FIXTURES.filter((fx) =>
      isCompliantEnvelope(loadFixture(fx.file))
    ).map((fx) => fx.file);
    expect(compliant).toEqual(["audit-service-channel-envelope-01.json"]);
  });
});

describe("toTrackedEventRow — full row projection (compliant fixture)", () => {
  const subject =
    "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1";
  const envelope = loadFixture(
    "audit-service-channel-envelope-01.json"
  ) as Record<string, unknown>;

  it("projects every column with the right authority", () => {
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const row = result.value;

    // Identity / subject.
    expect(row.event_id).toBe("env-ch-1");
    expect(row.subject).toBe(subject);

    // Descriptive dimensions from the envelope.
    expect(row.tenant).toBe("tenant-a");
    expect(row.producer).toBe("channel-service");
    expect(row.domain).toBe("messaging");

    // kind/version parsed from the subject (envelope carries neither).
    expect(row.kind).toBe("received");
    expect(row.version).toBe("v1");

    // Classification from classify(subject) — TAXONOMY.md §4 rule 3.
    expect(row.tech).toBe("whatsapp");
    expect(row.business_fn).toBe("channel-processing");
    expect(row.rule).toBe(3);

    // Facets.
    expect(row.consumed_by).toEqual([
      "workflow-service",
      "audit-service",
      "usage-aggregator-service",
      "agent-ai-service",
    ]);
    expect(row.is_claim_check).toBe(false);

    // Occurred-at from envelope.time; envelope stored verbatim.
    expect(row.occurred_at).toBe("2026-07-07T00:00:00.000Z");
    expect(row.envelope).toBe(envelope);

    // A fully compliant envelope is tagged compliance "full".
    expect(row.compliance).toBe("full");

    // T01 payload lifecycle: this fixture carries a non-null data.payload.
    expect(row.payload_status).toBe("inline");
    // Never set at insert time — only the T03 scrub job assigns this.
    expect(row.payload_scrubbed_at).toBeNull();
  });

  it("copies correlation columns VERBATIM (derives nothing)", () => {
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const row = result.value;

    expect(row.correlation_id).toBe(envelope.correlation_id as string);
    expect(row.causation_id).toBe(envelope.causation_id as null);
    // transport.depth = 0 in the fixture — copied, not defaulted to null.
    expect(row.causation_depth).toBe(0);
  });

  it("forwards streamName to the classifier (DLQ short-circuit, rule 1)", () => {
    // Same compliant body, but delivered on a DLQ stream: classification must
    // become DLQ (rule 1) via the forwarded streamName option.
    const result = toTrackedEventRow(subject, envelope, {
      streamName: "DLQ-tenant-a",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.business_fn).toBe("dlq");
    expect(result.value.rule).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T4 (trace-visualization) — click-through detail columns: workflow_id/run_id
// for workflow-execution events (rule 19), connector_id/cache_status for
// connector-invocation events (rule 11). One fixture per family, per tasks.md.
// ---------------------------------------------------------------------------
describe("toTrackedEventRow — T4 click-through detail columns", () => {
  function compliantEnvelope(overrides: Record<string, unknown>): unknown {
    return {
      specversion: "1.0",
      id: "evt-detail-1",
      source: "//test/detail",
      type: "io.yoizen.test.v1",
      resource: "tenant/acme/x",
      time: "2026-07-10T00:00:00.000Z",
      traceid: "11111111-1111-1111-1111-111111111111",
      causation_id: null,
      correlation_id: "corr-detail-1",
      tenant: "acme",
      producer: "workflow-service",
      domain: "workflow",
      channel: "internal",
      provider: "native",
      accountid: "system",
      idempotencykey: "idem-1",
      transport: { method: "stream", protocol: "internal", depth: 0 },
      data: {
        received_at: "2026-07-10T00:00:00.000Z",
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "x",
        payload: null,
      },
      ...overrides,
    };
  }

  it("workflow event (rule 19) extracts workflow_id (from executionId fallback) and run_id null", () => {
    const subject =
      "evt.acme.workflow-service.workflow.internal.native.execution_completed.v1";
    const envelope = compliantEnvelope({
      data: {
        received_at: "2026-07-10T00:00:00.000Z",
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "x",
        payload: { executionId: "exec-42", status: "COMPLETED" },
      },
    });
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rule).toBe(19);
    expect(result.value.workflow_id).toBe("exec-42");
    expect(result.value.run_id).toBeNull();
    expect(result.value.connector_id).toBeNull();
    expect(result.value.cache_status).toBeNull();
  });

  it("connector event (rule 11) with a cache hit extracts connector_id + cache_status", () => {
    const subject =
      "evt.acme.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1";
    const envelope = compliantEnvelope({
      producer: "connector-runtime",
      domain: "platform",
      channel: "endpoint",
      provider: "system",
      data: {
        received_at: "2026-07-10T00:00:00.000Z",
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "x",
        payload: {
          adapterId: "adapter-x",
          endpointId: "ep-1",
          cacheResult: "hit",
        },
      },
    });
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rule).toBe(11);
    expect(result.value.connector_id).toBe("adapter-x");
    expect(result.value.cache_status).toBe("hit");
    expect(result.value.workflow_id).toBeNull();
    expect(result.value.run_id).toBeNull();
  });

  it("connector event WITHOUT a cache result leaves cache_status null", () => {
    const subject =
      "evt.acme.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1";
    const envelope = compliantEnvelope({
      producer: "connector-runtime",
      domain: "platform",
      channel: "endpoint",
      provider: "system",
      data: {
        received_at: "2026-07-10T00:00:00.000Z",
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "x",
        payload: {
          adapterId: "adapter-x",
          endpointId: "ep-1",
          cacheResult: null,
        },
      },
    });
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.connector_id).toBe("adapter-x");
    expect(result.value.cache_status).toBeNull();
  });

  it("an unrelated event family (channel-processing, rule 3) has all four columns null", () => {
    const subject =
      "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1";
    const envelope = loadFixture(
      "audit-service-channel-envelope-01.json"
    ) as Record<string, unknown>;
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rule).toBe(3);
    expect(result.value.workflow_id).toBeNull();
    expect(result.value.run_id).toBeNull();
    expect(result.value.connector_id).toBeNull();
    expect(result.value.cache_status).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T01 (payload-capture) — payload lifecycle status assignment. The mapper
// assigns ONLY the two status-accurate terminal values at insert time:
// "inline" (data.payload present) and "none" (absent, including explicit
// JSON null and today's un-resolved claim-check rows). T02 refines the
// claim-check subset ("resolved"/"unresolved"); this mapper never assigns
// those, nor "scrubbed" (T03).
// ---------------------------------------------------------------------------
describe("toTrackedEventRow — T01 payload_status assignment", () => {
  const subject =
    "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1";

  function envelopeWithPayload(payload: unknown): Record<string, unknown> {
    return {
      specversion: "1.0",
      id: "evt-payload-1",
      source: "//test/payload",
      type: "io.yoizen.messaging.whatsapp.meta.received.v1",
      resource: "tenant/tenant-a/x",
      time: "2026-07-11T00:00:00.000Z",
      traceid: "22222222-2222-2222-2222-222222222222",
      causation_id: null,
      correlation_id: "corr-payload-1",
      tenant: "tenant-a",
      producer: "channel-service",
      domain: "messaging",
      channel: "whatsapp",
      provider: "meta",
      accountid: "acc-1",
      idempotencykey: "idem-payload-1",
      transport: { method: "webhook", protocol: "https", depth: 0 },
      data: {
        received_at: "2026-07-11T00:00:00.000Z",
        payload_inline: payload !== null,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "chk",
        payload,
      },
      kind: "received",
    };
  }

  it("assigns 'inline' when data.payload is a non-null object", () => {
    const envelope = envelopeWithPayload({ conversationId: "conv-1" });
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.payload_status).toBe("inline");
  });

  it("assigns 'none' when data.payload is explicit JSON null (today's un-resolved claim-check shape)", () => {
    const envelope = envelopeWithPayload(null);
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.payload_status).toBe("none");
  });

  it("assigns 'none' when data.payload is absent from an otherwise-compliant data object", () => {
    const envelope = envelopeWithPayload(null) as {
      data: Record<string, unknown>;
    };
    // `isCompliantEnvelope` requires the `data` object but does not itself
    // require the `payload` key to be present, so removing it (rather than
    // just nulling it) still reaches the mapper's success branch.
    delete envelope.data.payload;
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.payload_status).toBe("none");
  });

  it("never assigns payload_scrubbed_at at insert time", () => {
    const envelope = envelopeWithPayload({ conversationId: "conv-1" });
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.payload_scrubbed_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T05 of connection-call-inspector.md — the new mcp_call_completed
// (rule 24) / llm_call_completed (rule 25) kinds ride the SAME
// payload_status lifecycle as every other kind: "inline" when
// data.payload is present. This mapper does not special-case them —
// these tests guard that the generic rule stays true for the new families.
// ---------------------------------------------------------------------------
describe("toTrackedEventRow — T05 new kinds classify and get payload_status 'inline'", () => {
  function baseEnvelope(
    overrides: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      specversion: "1.0",
      id: "evt-t05-1",
      source: "//test/t05",
      resource: "test/resource",
      time: "2026-07-28T00:00:00.000Z",
      traceid: "33333333-3333-3333-3333-333333333333",
      causation_id: null,
      correlation_id: "corr-t05-1",
      tenant: "acme",
      accountid: "acme",
      idempotencykey: "idem-t05-1",
      transport: { method: "stream", protocol: "internal", depth: 0 },
      ...overrides,
    };
  }

  it("mcp_call_completed classifies as rule 24 with payload_status 'inline'", () => {
    const subject =
      "evt.acme.connector-runtime.platform.mcp.system.mcp_call_completed.v1";
    const envelope = baseEnvelope({
      type: "connector.mcp_call.completed.v1",
      resource: "mcp/mcp-server-1",
      producer: "connector-runtime",
      domain: "platform",
      channel: "mcp",
      provider: "system",
      data: {
        received_at: "2026-07-28T00:00:00.000Z",
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 100,
        payload_checksum: "chk",
        payload: {
          serverName: "server-1",
          mcpServerId: "mcp-server-1",
          toolName: "search",
          success: true,
          durationMs: 12,
        },
      },
    });
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rule).toBe(24);
    expect(result.value.tech).toBe("connector");
    expect(result.value.business_fn).toBe("connector-invocation");
    expect(result.value.payload_status).toBe("inline");
  });

  it("llm_call_completed classifies as rule 25 with payload_status 'inline'", () => {
    const subject =
      "evt.acme.agent-ai-service.platform.llm.system.llm_call_completed.v1";
    const envelope = baseEnvelope({
      type: "ai.llm_call.completed.v1",
      resource: "execution/exec-1",
      producer: "agent-ai-service",
      domain: "platform",
      channel: "llm",
      provider: "system",
      data: {
        received_at: "2026-07-28T00:00:00.000Z",
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 100,
        payload_checksum: "chk",
        payload: {
          model: "gpt-4o-mini",
          provider: "openai",
          prompt: "hi",
          completion: "hello",
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.0001,
          durationMs: 10,
        },
      },
    });
    const result = toTrackedEventRow(subject, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rule).toBe(25);
    expect(result.value.tech).toBe("platform");
    expect(result.value.business_fn).toBe("llm-invocation");
    expect(result.value.payload_status).toBe("inline");
  });
});

// ---------------------------------------------------------------------------
// T01 (payload-capture) — non-envelope rows (buildNonEnvelopeRow, T07) never
// carry a payload: payload_status must be "none".
// ---------------------------------------------------------------------------
describe("buildNonEnvelopeRow — T01 payload_status", () => {
  it("always assigns payload_status 'none' (non-envelope bodies carry no data.payload shape)", async () => {
    const { buildNonEnvelopeRow } = await import(
      "../src/lib/build-non-envelope-row.js"
    );
    const row = buildNonEnvelopeRow({
      subject: "audit.gateway.request",
      streamName: "GATEWAY_AUDIT",
      streamSequence: 41771,
      payload: { some: "raw-body" },
      receivedAt: "2026-07-11T00:00:00.000Z",
      tech: "gateway-audit",
      businessFn: "audit",
      rule: 14,
    });
    expect(row.payload_status).toBe("none");
    expect(row.payload_scrubbed_at).toBeNull();
  });
});

describe("toTrackedEventRow — malformed / expected failures", () => {
  const subject =
    "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1";

  it("rejects an empty subject", () => {
    const result = toTrackedEventRow("", { id: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_subject");
    }
  });

  it("rejects a null envelope on a canonical subject as malformed_envelope", () => {
    const result = toTrackedEventRow(subject, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Canonical `evt.` family (rule 3) with a non-envelope body → drift.
      expect(result.error.kind).toBe("malformed_envelope");
    }
  });

  it("rejects a malformed (partial) envelope as malformed_envelope", () => {
    // Missing specversion/source/type/... — a classic malformed envelope.
    const malformed = {
      id: "evt-malformed",
      tenant: "tenant-a",
      correlation_id: "corr-1",
    };
    const result = toTrackedEventRow(subject, malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("malformed_envelope");
    }
  });

  it("rejects a non-object envelope (string)", () => {
    const result = toTrackedEventRow(subject, "not-an-envelope");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STAGE-1 INGRESS EXCEPTION — user-approved decision "option A:
// canonical-with-known-drift" (resolves T13 blocker 2). A real, live stage-1
// `webhook_received` envelope (TAXONOMY.md §4 rule 2) is built by api-gateway as
// `WebhookIngressEnvelope = Omit<EventEnvelope, "accountid">` — DRIFT.md rows
// 6 & 7. When accountid is its SOLE compliance failure the mapper treats it as
// canonical (compliance "partial"); ANY other failure keeps flowing to drift.
// ---------------------------------------------------------------------------
describe("toTrackedEventRow — STAGE-1 INGRESS EXCEPTION (canonical-with-known-drift)", () => {
  // Load the REAL captured stage-1 envelope from the golden sample, so the test
  // asserts against production shape, not a hand-built approximation.
  const GOLDEN_PATH = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "golden",
    "raw",
    "INGRESS-ACME-seq1242.json"
  );
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
    subject: string;
    envelope: Record<string, unknown>;
  };
  const STAGE1_SUBJECT = golden.subject;

  it("the golden stage-1 envelope fails compliance ONLY because accountid is absent", () => {
    // Precondition of the exception's exact width: the sole-failure probe.
    expect(isCompliantEnvelope(golden.envelope)).toBe(false);
    expect(
      isCompliantEnvelope({ ...golden.envelope, accountid: "acc-probe" })
    ).toBe(true);
  });

  it("maps a stage-1 webhook_received envelope to a canonical row tagged compliance partial", () => {
    const result = toTrackedEventRow(STAGE1_SUBJECT, golden.envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const row = result.value;

    // Classified by SUBJECT — rule 2, ingress, tech from the channel token.
    expect(row.rule).toBe(2);
    expect(row.business_fn).toBe("ingress");
    expect(row.tech).toBe("telegram");

    // Correlation_id + tenant preserved from the envelope; real (non-synthesized)
    // event_id is the envelope id.
    expect(row.event_id).toBe(golden.envelope.id as string);
    expect(row.correlation_id).toBe(golden.envelope.correlation_id as string);
    expect(row.tenant).toBe(golden.envelope.tenant as string);

    // The decision's verdict column.
    expect(row.compliance).toBe("partial");

    // The ORIGINAL body is stored verbatim — the internal accountid probe never
    // leaks into the persisted envelope.
    expect(row.envelope).toBe(golden.envelope);
    expect("accountid" in (row.envelope as Record<string, unknown>)).toBe(
      false
    );
  });

  it("INVERSE (exact width): a stage-1 subject whose body fails on MORE than accountid goes to drift, not the exception", () => {
    // Same stage-1 event, but ALSO strip correlation_id — now two fields are
    // non-compliant, so the accountid-only sole-failure probe returns null and
    // the message must fall through to the drift path (malformed_envelope), NOT
    // the partial exception. This proves the exception is no wider than the
    // known accountid-only case.
    const { correlation_id: _dropped, ...broken } = golden.envelope;
    const result = toTrackedEventRow(STAGE1_SUBJECT, broken);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("malformed_envelope");
  });

  it("does NOT apply the exception to a non-stage-1 subject missing only accountid", () => {
    // Subject gate: a canonical stage-2 `received` subject (rule 3), not rule 2.
    // Even though accountid is the sole compliance failure, the subject is not
    // the stage-1 webhook family, so this is ordinary drift.
    const stage2Subject =
      "evt.acme.channel-service.messaging.telegram.meta.received.v1";
    const result = toTrackedEventRow(stage2Subject, golden.envelope);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("malformed_envelope");
  });
});
