// Posts a batch of `OtelSpan`s (T1's pure mapper output) as OTLP/HTTP JSON to
// the in-cluster otel-collector's `/v1/traces` endpoint.
//
// Fire-and-forget contract (T2 of .sdd/changes/trace-visualization/tasks.md):
// export is a SIDE CHANNEL for observability, never a correctness dependency of
// ingestion. This function therefore NEVER throws — every failure (network
// error, non-2xx status) is caught, logged verbosely, and returned as a
// structured `err`, so a caller that ignores the result (as
// `tracked-event-buffer.ts` does) keeps working even when Tempo/collector is
// down.
//
// `endpoint === undefined` is the disabled state (OTEL_EXPORT_ENABLED=false, or
// unset): a documented no-op that never touches `fetch`, matching
// `load-config.ts`'s "disabled = no-op emitter" contract.

import { err, ok, type Result } from "./result.js";
import type { OtelSpan } from "./to-otel-span.js";

/** Minimal `fetch`-shaped dependency, injected so tests never touch the network. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface EmitOk {
  sent: number;
}

export interface EmitError {
  reason: string;
}

/** OTLP KeyValue — https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding */
interface OtlpKeyValue {
  key: string;
  value: { stringValue?: string; boolValue?: boolean };
}

function toOtlpAttributes(span: OtelSpan): OtlpKeyValue[] {
  const attrs = span.attributes;
  const kv: OtlpKeyValue[] = [
    { key: "tech", value: { stringValue: attrs.tech } },
    { key: "business_fn", value: { stringValue: attrs.business_fn } },
    { key: "is_claim_check", value: { boolValue: attrs.is_claim_check } },
    { key: "compliance", value: { stringValue: attrs.compliance } },
  ];
  if (attrs.tenant !== null) {
    kv.push({ key: "tenant", value: { stringValue: attrs.tenant } });
  }
  if (attrs.causation_missing) {
    kv.push({ key: "causation_missing", value: { boolValue: true } });
  }
  return kv;
}

function toOtlpSpan(span: OtelSpan): Record<string, unknown> {
  return {
    traceId: span.trace_id,
    spanId: span.span_id,
    ...(span.parent_span_id ? { parentSpanId: span.parent_span_id } : {}),
    name: span.name,
    startTimeUnixNano: span.start_time_unix_nano,
    endTimeUnixNano: span.end_time_unix_nano,
    kind: 1, // SPAN_KIND_INTERNAL — bus events have no client/server RPC role.
    attributes: toOtlpAttributes(span),
  };
}

/** Groups spans by `service_name` into one `resourceSpans` entry each. */
function toOtlpEnvelope(spans: readonly OtelSpan[]): Record<string, unknown> {
  const byService = new Map<string, OtelSpan[]>();
  for (const span of spans) {
    const bucket = byService.get(span.service_name);
    if (bucket) {
      bucket.push(span);
    } else {
      byService.set(span.service_name, [span]);
    }
  }

  const resourceSpans = [...byService.entries()].map(
    ([serviceName, serviceSpans]) => ({
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: serviceName } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "tracking-ingester-service" },
          spans: serviceSpans.map(toOtlpSpan),
        },
      ],
    })
  );

  return { resourceSpans };
}

/**
 * Exports `spans` as OTLP/HTTP JSON to `endpoint` (POST, `/v1/traces` shape).
 *
 * @param endpoint OTEL_EXPORTER_OTLP_ENDPOINT, or `undefined` when export is
 *   disabled (no-op — `fetchImpl` is never called).
 * @param spans batch to export; an empty batch is also a no-op.
 * @param fetchImpl injected `fetch`-shaped function (defaults to global `fetch`).
 * @param log verbose line logger (defaults to no-op); always called on failure.
 */
export async function emitOtelSpans(
  endpoint: string | undefined,
  spans: readonly OtelSpan[],
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  log: (message: string) => void = () => {}
): Promise<Result<EmitOk, EmitError>> {
  if (!endpoint) {
    log("emitOtelSpans: export disabled (no endpoint) — skipping");
    return ok({ sent: 0 });
  }
  if (spans.length === 0) {
    log("emitOtelSpans: empty span batch — skipping");
    return ok({ sent: 0 });
  }

  log(`emitOtelSpans: exporting ${spans.length} span(s) to ${endpoint}`);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toOtlpEnvelope(spans)),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const reason = `otel-collector responded ${response.status}${body ? `: ${body}` : ""}`;
      log(`emitOtelSpans: export FAILED — ${reason}`);
      return err<EmitError>({ reason });
    }

    log(`emitOtelSpans: export OK — ${spans.length} span(s) sent`);
    return ok({ sent: spans.length });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`emitOtelSpans: export FAILED — ${reason}`);
    return err<EmitError>({ reason });
  }
}
