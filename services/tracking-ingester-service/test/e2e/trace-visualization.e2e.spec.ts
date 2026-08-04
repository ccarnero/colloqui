// End-to-end verification for .sdd/changes/trace-visualization/tasks.md T8.
//
// SKIPS cleanly (logged reason) when POSTGRES_URL/DATABASE_URL is unset, matching
// the repo-local integration-test convention already used by
// `test/insert-tracked-events.spec.ts` (this service has no NestJS/testcontainers
// setup — a plain Bun functional service — so that convention, not other
// services' `test/e2e/setup.ts` pattern, is the one that applies here).
//
// FIXTURE CHAIN — no pre-existing 11-event fixture file exists in
// fixtures/bus-events/ (verified during T1), so this test hand-builds an
// 11-event / 10-edge CAUSAL TREE (not a flat linear chain — verified against a
// REAL already-ingested dev chain, correlation_id 8c2479be-95c1-460f-bbd7-
// a9b79312952c, which fans out from `received` into three children exactly
// like this fixture does) covering: ingress, channel-processing, a branching
// agent-execution pair (execution_started/execution_completed sharing a
// call_id), a connector-invocation call, a workflow-execution completion, and
// a channel-egress lifecycle (send/sent/delivered/read).
//
// DOCUMENTED INTERPRETATION of T8's "workflow + agent spans carry duration > 0"
// (apply-progress.md T8 discovery): `execution-completed-publisher.activity.ts`
// (the only workflow-execution bus publisher in the codebase) emits ONLY
// `execution_completed` — there is no `execution_started` bus event, so a
// workflow-execution span-pair NEVER exists in the real system and is honestly
// zero-duration by design in BOTH Tempo (real-time per-row export, T2) and
// `tracking.tracked_event_spans` (T1's pairing view). agent-execution DOES emit
// a real started/completed pair (confirmed against the same real dev chain), so
// THIS test verifies duration > 0 for the agent-execution pair via T1's pairing
// view (the query-time surface — T6's connector-detail dashboard reads it the
// same way), and verifies Tempo independently for span count + causal
// parent-child correctness (real-time zero-duration point spans, per T2's
// documented design).

import { describe, expect, it } from "bun:test";
import type { EventEnvelope } from "@yoizen/shared";
import { emitOtelSpans } from "../../src/lib/emit-otel-spans.js";
import { insertTrackedEvents } from "../../src/lib/insert-tracked-events.js";
import { toOtelSpan, toSpanId } from "../../src/lib/to-otel-span.js";
import { toSpanSourceRow } from "../../src/lib/to-span-source-row.js";
import { toTrackedEventRow } from "../../src/lib/to-tracked-event-row.js";

const DSN =
  process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();
const OTEL_COLLECTOR_URL =
  process.env.OTEL_COLLECTOR_URL?.trim() || "http://localhost:4318/v1/traces";
const TEMPO_QUERY_URL =
  process.env.TEMPO_QUERY_URL?.trim() || "http://localhost:3200";

// Explicit guard for array/destructure accesses that TypeScript can't prove
// are in-bounds — throws loudly instead of silently allowing `undefined`
// through a non-null assertion (forbidden by lint/style/noNonNullAssertion).
function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

describe("trace-visualization E2E (T8) — dev stack", () => {
  if (!DSN) {
    it("SKIPPED — set POSTGRES_URL or DATABASE_URL to run against dev Postgres", () => {
      console.log(
        "[trace-visualization.e2e] SKIPPED: neither POSTGRES_URL nor DATABASE_URL is set"
      );
      expect(DSN).toBeUndefined();
    });
    return;
  }

  it("ingests an 11-event/10-edge telegram chain and verifies Tempo + node-graph SQL + T4 columns", async () => {
    const { default: postgres } = await import("postgres");
    const sql = postgres(DSN, { max: 1, prepare: false });
    // Warmup query — mirrors main.ts's own first Postgres action. A fresh
    // connection's absolute-first query can race ahead of postgres.js/Bun's
    // type-OID negotiation and spuriously fail array-typed UNNEST inserts
    // (observed live while building this test); a trivial round trip first
    // avoids it, exactly like the composition edge already does.
    await sql`SELECT 1`;

    const runId = `e2e-tv-${Date.now()}`;
    const tenant = "acme";
    const correlationId = crypto.randomUUID();
    const execId = `exec-${runId}`;
    const callId = `call-${runId}`;
    const t0 = Date.now();

    // Each event's `id` is a real UUID so to-otel-span.ts's hex derivation is
    // exercised exactly as it runs in production.
    const ids = Array.from({ length: 11 }, () => crypto.randomUUID());

    function envelope(
      index: number,
      opts: {
        subject: string;
        causationOf: number | null;
        payload?: Record<string, unknown>;
        offsetMs: number;
      }
    ): { subject: string; envelope: EventEnvelope } {
      const [, , producer, domain, channel, provider] = opts.subject.split(".");
      return {
        subject: opts.subject,
        envelope: {
          specversion: "1.0",
          id: requireDefined(ids[index], `ids[${index}] is out of range`),
          source: `${producer}/e2e`,
          type: "io.yoizen.e2e.v1",
          resource: `tenant/${tenant}/e2e/${runId}`,
          time: new Date(t0 + opts.offsetMs).toISOString(),
          traceid: crypto.randomUUID(),
          causation_id:
            opts.causationOf === null
              ? null
              : requireDefined(
                  ids[opts.causationOf],
                  `ids[${opts.causationOf}] is out of range`
                ),
          correlation_id: correlationId,
          tenant,
          producer: requireDefined(
            producer,
            `subject "${opts.subject}" has no producer segment`
          ),
          domain: requireDefined(
            domain,
            `subject "${opts.subject}" has no domain segment`
          ),
          channel: requireDefined(
            channel,
            `subject "${opts.subject}" has no channel segment`
          ),
          provider: requireDefined(
            provider,
            `subject "${opts.subject}" has no provider segment`
          ),
          accountid: tenant,
          idempotencykey: `${runId}:${index}`,
          transport: { method: "stream", protocol: "internal", depth: index },
          data: {
            received_at: new Date(t0 + opts.offsetMs).toISOString(),
            payload_inline: true,
            payload_ref: null,
            payload_bytes: 0,
            payload_checksum: "e2e",
            payload: opts.payload ?? null,
          },
        },
      };
    }

    // 0: webhook_received (ingress, root)
    // 1: received (channel-processing) <- 0
    // 2: execution_requested (agent-execution) <- 1
    // 3: send (channel-egress) <- 1
    // 4: execution_completed (workflow-execution, NEVER paired — see header note) <- 1
    // 5: execution_started (agent-execution, pairs with 7) <- 2
    // 6: endpoint_call_completed (connector-invocation) <- 5
    // 7: execution_completed (agent-execution, pairs with 5) <- 5
    // 8: sent (channel-egress) <- 4
    // 9: delivered (channel-egress) <- 8
    // 10: read (channel-egress) <- 9
    const fixtures = [
      envelope(0, {
        subject: `evt.${tenant}.api-gateway.messaging.telegram.webhook.webhook_received.v1`,
        causationOf: null,
        offsetMs: 0,
      }),
      envelope(1, {
        subject: `evt.${tenant}.channel-service.messaging.telegram.telegram.received.v1`,
        causationOf: 0,
        offsetMs: 50,
      }),
      envelope(2, {
        subject: `evt.${tenant}.ai-agent-gateway.automation.platform.internal.execution_requested.v1`,
        causationOf: 1,
        payload: { call_id: callId },
        offsetMs: 100,
      }),
      envelope(3, {
        subject: `evt.${tenant}.channel-service.messaging.telegram.telegram.send.v1`,
        causationOf: 1,
        offsetMs: 120,
      }),
      envelope(4, {
        subject: `evt.${tenant}.workflow-service.workflow.internal.native.execution_completed.v1`,
        causationOf: 1,
        payload: { executionId: execId, status: "COMPLETED" },
        offsetMs: 150,
      }),
      envelope(5, {
        subject: `evt.${tenant}.ai-agent-gateway.automation.platform.internal.execution_started.v1`,
        causationOf: 2,
        payload: { call_id: callId },
        offsetMs: 200,
      }),
      envelope(6, {
        subject: `evt.${tenant}.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1`,
        causationOf: 5,
        payload: {
          adapterId: "adapter-e2e",
          endpointId: "ep-e2e",
          method: "GET",
          resolvedUrl: "https://example.test/e2e",
          status: 200,
          durationMs: 120,
          cacheResult: "hit",
        },
        offsetMs: 300,
      }),
      envelope(7, {
        subject: `evt.${tenant}.ai-agent-gateway.automation.platform.internal.execution_completed.v1`,
        causationOf: 5,
        payload: { call_id: callId },
        // 5000ms after the pair's start (index 5) so duration_ms is clearly > 0.
        offsetMs: 5300,
      }),
      envelope(8, {
        subject: `evt.${tenant}.channel-service.messaging.telegram.telegram.sent.v1`,
        causationOf: 4,
        offsetMs: 5400,
      }),
      envelope(9, {
        subject: `evt.${tenant}.channel-service.messaging.telegram.telegram.delivered.v1`,
        causationOf: 8,
        offsetMs: 5500,
      }),
      envelope(10, {
        subject: `evt.${tenant}.channel-service.messaging.telegram.telegram.read.v1`,
        causationOf: 9,
        offsetMs: 5600,
      }),
    ];

    try {
      // 1. Map + insert every event through the REAL T04/T4 mapper.
      const rows = fixtures.map((fx) => {
        const mapped = toTrackedEventRow(fx.subject, fx.envelope);
        if (!mapped.ok) {
          throw new Error(
            `fixture ${fx.subject} failed to map: ${JSON.stringify(mapped.error)}`
          );
        }
        return mapped.value;
      });
      expect(rows).toHaveLength(11);

      const inserted = await insertTrackedEvents(sql, rows);
      expect(inserted.ok).toBe(true);
      if (inserted.ok) {
        expect(inserted.value.inserted).toBe(11);
      }

      // 2. T4 — workflow_id/run_id + connector_id/cache_status populated.
      const workflowRow = rows.find((r) => r.rule === 19);
      expect(workflowRow).toBeDefined();
      if (!workflowRow) {
        throw new Error("workflow row (rule 19) not found in mapped rows");
      }
      expect(workflowRow.workflow_id).toBe(execId); // executionId fallback (T4 discovery)
      const connectorRow = rows.find((r) => r.rule === 11);
      expect(connectorRow).toBeDefined();
      if (!connectorRow) {
        throw new Error("connector row (rule 11) not found in mapped rows");
      }
      expect(connectorRow.connector_id).toBe("adapter-e2e");
      expect(connectorRow.cache_status).toBe("hit");

      // 3. T5's exact node-graph SQL (nodes + edges) — 11 nodes / 10 edges.
      const nodes = await sql.unsafe(
        `SELECT event_id AS id FROM tracking.tracked_events WHERE correlation_id = '${correlationId}'`
      );
      expect(nodes).toHaveLength(11);
      const edges = await sql.unsafe(`
          SELECT e.event_id AS id, s.event_id AS source, e.event_id AS target
          FROM tracking.tracked_events e
          JOIN tracking.tracked_events s ON s.event_id = e.causation_id
          WHERE e.correlation_id = '${correlationId}'
        `);
      expect(edges).toHaveLength(10);

      // 4. T1's pairing view — the agent-execution pair (index 5 & 7, shared
      // call_id) collapses into ONE span with duration_ms > 0.
      const spanRows = await sql.unsafe<
        { event_id: string; duration_ms: number }[]
      >(
        `SELECT event_id, duration_ms FROM tracking.tracked_event_spans WHERE correlation_id = '${correlationId}' ORDER BY start_time`
      );
      // 11 source rows - 1 (the "completed" half consumed into the pair) = 10 span rows.
      expect(spanRows).toHaveLength(10);
      const agentPairSpan = spanRows.find((r) => r.event_id === ids[5]);
      expect(agentPairSpan).toBeDefined();
      expect(Number(agentPairSpan?.duration_ms)).toBeGreaterThan(0);
      // Workflow (rule 19) never pairs — zero-duration by design (see header note).
      const workflowSpan = spanRows.find((r) => r.event_id === ids[4]);
      expect(workflowSpan).toBeDefined();
      expect(Number(workflowSpan?.duration_ms)).toBe(0);

      // 5. T2 — export every row as a real-time OTel span (one per row, per
      // to-span-source-row.ts's documented design) to the live collector.
      const spans = rows.map((row) => toOtelSpan(toSpanSourceRow(row)));
      expect(spans).toHaveLength(11);
      const emitResult = await emitOtelSpans(OTEL_COLLECTOR_URL, spans);
      expect(emitResult.ok).toBe(true);

      // 6. Poll Tempo for the trace — 11 spans, causation-correct parent chain.
      // Tempo's HTTP query API returns spanId/parentSpanId as base64 (OTLP/JSON
      // "bytes" encoding), NOT the hex we sent over OTLP/HTTP — decode back to
      // hex so the comparison is against to-otel-span.ts's actual hex IDs.
      const b64ToHex = (b64: string): string =>
        Buffer.from(b64, "base64").toString("hex");

      const traceId = correlationId.replace(/-/g, "");
      let tempoSpans: Array<{
        spanId: string;
        parentSpanId?: string;
      }> = [];
      for (let attempt = 0; attempt < 15; attempt++) {
        const res = await fetch(`${TEMPO_QUERY_URL}/api/traces/${traceId}`);
        if (res.ok) {
          const body = (await res.json()) as {
            batches: Array<{
              scopeSpans: Array<{
                spans: Array<{ spanId: string; parentSpanId?: string }>;
              }>;
            }>;
          };
          tempoSpans = body.batches
            .flatMap((b) => b.scopeSpans.flatMap((s) => s.spans))
            .map((s) => ({
              spanId: b64ToHex(s.spanId),
              parentSpanId: s.parentSpanId
                ? b64ToHex(s.parentSpanId)
                : undefined,
            }));
          if (tempoSpans.length >= 11) {
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(tempoSpans.length).toBe(11);

      // Root (index 0) has no parent; every other span's parent matches the
      // hex-derived span id of its causation event.
      const rootSpanId = toSpanId(
        requireDefined(ids[0], "ids[0] is out of range")
      );
      const rootTempoSpan = tempoSpans.find((s) => s.spanId === rootSpanId);
      expect(rootTempoSpan).toBeDefined();
      expect(rootTempoSpan?.parentSpanId ?? "").toBe("");

      for (let i = 1; i < fixtures.length; i++) {
        const fixture = requireDefined(
          fixtures[i],
          `fixtures[${i}] is out of range`
        );
        const causationId = fixture.envelope.causation_id;
        if (causationId === null) {
          continue;
        }
        const parentIndex = ids.indexOf(causationId);
        const expectedParentSpanId = toSpanId(
          requireDefined(
            ids[parentIndex],
            `ids[${parentIndex}] is out of range`
          )
        );
        const currentId = requireDefined(ids[i], `ids[${i}] is out of range`);
        const span = tempoSpans.find((s) => s.spanId === toSpanId(currentId));
        expect(span).toBeDefined();
        expect(span?.parentSpanId).toBe(expectedParentSpanId);
      }
    } finally {
      await sql`DELETE FROM tracking.tracked_events WHERE correlation_id = ${correlationId}`;
      await sql.end({ timeout: 5 });
    }
  }, 30_000); // Tempo polling can take a few seconds after export; generous but bounded.
});
