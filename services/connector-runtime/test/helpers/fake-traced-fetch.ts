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
import {
  handleFakeCacheServiceRequest,
  resetFakeCacheService,
} from "./fake-cache-service";

export type TracedFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

let activeTracedFetch: TracedFetchImpl = () =>
  Promise.resolve(new Response("{}", { status: 200 }));

/**
 * Call in `beforeEach`/before importing the unit under test so calls land on
 * YOUR fake.
 *
 * ALSO clears the in-memory cache-service double (`fake-cache-service.ts`):
 * since T11/E36b the HTTP-response cache is a real, stateful store behind the
 * same `tracedFetch` edge, and leaking entries between tests would silently
 * turn a spec's intended cache MISS into a HIT (its upstream fake would then
 * never be called at all). The Redis double this replaced was stateless per
 * spec file, so resetting here keeps the previous isolation guarantee.
 */
export function setActiveTracedFetch(fn: TracedFetchImpl): void {
  activeTracedFetch = fn;
  resetFakeCacheService();
}

/** Sink for the fake logger's calls; see `setActiveLoggerSink`. */
export interface FakeLoggerSink {
  log?: (message: string) => void;
  warn?: (message: string) => void;
  debug?: (message: string) => void;
  error?: (message: string) => void;
}

let activeLoggerSink: FakeLoggerSink = {};

/**
 * Routes `PinoLoggerService` calls to YOUR sink (same mutable-indirection
 * rationale as `setActiveTracedFetch`: the double is registered once for the
 * whole process, so log assertions must resolve at CALL time). Call with `{}`
 * in `beforeEach` to stop recording.
 */
export function setActiveLoggerSink(sink: FakeLoggerSink): void {
  activeLoggerSink = sink;
}

class FakeLogger {
  log(message: unknown) {
    activeLoggerSink.log?.(String(message));
  }
  warn(message: unknown) {
    activeLoggerSink.warn?.(String(message));
  }
  // `debug` exists on the real `PinoLoggerService` and IS called in
  // production code (e.g. the cache-service-backed HTTP-response cache
  // store), so the double must expose it too — omitting it turned a plain
  // debug log into a `TypeError` swallowed by the store's catch-all.
  debug(message: unknown) {
    activeLoggerSink.debug?.(String(message));
  }
  error(message: unknown) {
    activeLoggerSink.error?.(String(message));
  }
}

mock.module("@yoizen/observability", () => ({
  // cache-service traffic (the HTTP-response cache store, T11/E36b) is served
  // by the in-memory `fake-cache-service` double BEFORE the spec's own fake
  // sees it — see that file's header for why.
  tracedFetch: (...args: Parameters<TracedFetchImpl>) => {
    const cacheResponse = handleFakeCacheServiceRequest(args[0], args[1]);
    if (cacheResponse) {
      return Promise.resolve(cacheResponse);
    }
    return activeTracedFetch(...args);
  },
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
