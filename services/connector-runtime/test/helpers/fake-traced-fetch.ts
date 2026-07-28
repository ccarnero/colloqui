// Shared `"@yoizen/observability"` module double, mirroring
// `fake-nats-jetstream.ts`'s rationale and fix shape.
//
// WHY THIS EXISTS (bun `mock.module` + ESM singleton interaction):
// `tracedFetch` (and `PinoLoggerService`, `getMeter`, etc.) are imported via a
// top-level `import { tracedFetch } from "@yoizen/observability"` inside
// `activities/_shared/adapter-client.provider.ts` — a module `bun test`
// evaluates ONCE across the whole run (it backs the process-wide
// `getAdapterClient()` singleton, shared by `endpoint-call-core.ts` AND
// `service-call.activity.ts`). Whichever spec file's own private
// `mock.module("@yoizen/observability", ...)` happened to be registered at
// that ONE evaluation moment wins FOREVER — a later spec file's own
// `mock.module("@yoizen/observability", anotherFactory)` does NOT
// retroactively rebind it, silently starving that spec's own `tracedFetch`
// assertions (confirmed empirically: `service-call.activity.spec.ts`'s
// mirror-lookup tests saw a DIFFERENT spec file's generic 200-JSON responder
// instead of their own routed fake when run in the same `bun test` process —
// `manual-loops/connectors/connection-call-inspector.md` T01).
//
// FIX: route every "@yoizen/observability" double through this ONE canonical
// `mock.module` call (whichever spec file's import graph touches
// `@yoizen/observability` first doesn't matter — the factory itself only
// delegates to a mutable indirection cell), and have every consuming spec
// file reassign `activeTracedFetch` via `setActiveTracedFetch` in its own
// `beforeEach` so `tracedFetch` calls always land on THAT file's currently
// active fake, resolved at CALL TIME rather than at binding time.
import { mock } from "bun:test";

export type TracedFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

let activeTracedFetch: TracedFetchImpl = () =>
  Promise.resolve(new Response("{}", { status: 200 }));

/** Call in `beforeEach`/before importing the unit under test so calls land on YOUR fake. */
export function setActiveTracedFetch(fn: TracedFetchImpl): void {
  activeTracedFetch = fn;
}

class FakeLogger {
  log() {}
  warn() {}
  error() {}
}

mock.module("@yoizen/observability", () => ({
  tracedFetch: (...args: Parameters<TracedFetchImpl>) =>
    activeTracedFetch(...args),
  PinoLoggerService: FakeLogger,
  getMeter: () => ({
    createCounter: () => ({ add() {} }),
    createHistogram: () => ({ record() {} }),
  }),
  startNatsProducerSpan: () => ({ span: { end() {} } }),
  startNatsConsumerSpan: () => ({ span: { end() {} } }),
  injectTraceContext: () => {},
  activeOrRandomTraceId: () => "trace-1",
  logWithEnvelope: () => {},
  createCircuitBreakerMetrics: () => ({
    recordDecision() {},
    recordTransition() {},
    recordL1Hit() {},
    recordRedisError() {},
    recordDecideDuration() {},
  }),
}));
