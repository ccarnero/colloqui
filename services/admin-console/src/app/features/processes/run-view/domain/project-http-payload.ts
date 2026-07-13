// project-http-payload.ts — splits ONE stored `endpoint_call_completed`
// payload into a request-side or response-side projection for the run-view
// popup (T09 of manual-loops/connector-trace-linking.md). Pure function, no
// Angular/DOM.
//
// The connector's endpoint_call payload is a SINGLE event carrying both
// halves of the round trip (verified live via the chain payload endpoint):
//   { method, resolvedUrl, status, durationMs, cacheResult,
//     requestHeaders, requestBody, responseHeaders, responseBody }
// The popup fetches it ONCE (through the existing payload viewer flow) and
// this function projects the half the user asked for — request fields vs
// response fields — instead of dumping the raw JSON. Every field is optional
// (older events, redaction, claim-check resolution), so each is read
// defensively and simply omitted when absent.

export type HttpPayloadSide = "request" | "response";

export interface IHttpPayloadRow {
  readonly label: string;
  readonly value: string;
}

export interface IHttpPayloadProjection {
  readonly side: HttpPayloadSide;
  /** Scalar fields (method/URL for request; status/duration/cache for
   * response), in display order, omitting any absent field. */
  readonly rows: readonly IHttpPayloadRow[];
  /** Pretty-printed `k: v` header block, or `null` when no headers. */
  readonly headers: string | null;
  /** Body as a string (JSON-pretty for objects, verbatim for strings), or
   * `null` when no body. */
  readonly body: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asScalarString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function formatHeaders(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const lines = Object.entries(record).map(
    ([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`
  );
  return lines.length > 0 ? lines.join("\n") : null;
}

function formatBody(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Projects `payload` (an `endpoint_call_completed` event payload) onto its
 * request-side or response-side view. A non-object payload yields an
 * all-empty projection (no rows/headers/body) rather than throwing.
 */
export function projectHttpPayload(
  payload: unknown,
  side: HttpPayloadSide
): IHttpPayloadProjection {
  const record = asRecord(payload) ?? {};
  const rows: IHttpPayloadRow[] = [];

  if (side === "request") {
    const method = asScalarString(record["method"]);
    const url = asScalarString(record["resolvedUrl"]);
    if (method !== null) {
      rows.push({ label: "method", value: method });
    }
    if (url !== null) {
      rows.push({ label: "url", value: url });
    }
    return {
      side,
      rows,
      headers: formatHeaders(record["requestHeaders"]),
      body: formatBody(record["requestBody"]),
    };
  }

  const status = asScalarString(record["status"]);
  const durationMs = asScalarString(record["durationMs"]);
  const cacheResult = asScalarString(record["cacheResult"]);
  if (status !== null) {
    rows.push({ label: "status", value: status });
  }
  if (durationMs !== null) {
    rows.push({ label: "duration", value: `${durationMs} ms` });
  }
  if (cacheResult !== null) {
    rows.push({ label: "cache", value: cacheResult });
  }
  return {
    side,
    rows,
    headers: formatHeaders(record["responseHeaders"]),
    body: formatBody(record["responseBody"]),
  };
}
