// Shared `"@yoizen/observability"` module double for proxy-service unit specs,
// mirroring `services/connector-runtime/test/helpers/fake-traced-fetch.ts`.
//
// WHY THIS EXISTS (bun `mock.module` + ESM singleton interaction):
// `tracedFetch` is imported via a top-level
// `import { tracedFetch } from "@yoizen/observability"` inside
// `health.controller.ts` and `proxy.service.ts` — modules `bun test` evaluates
// ONCE across the whole run. Whichever spec file's own private
// `mock.module("@yoizen/observability", ...)` was registered at that ONE
// evaluation moment wins FOREVER: a later spec file's own `mock.module` call
// does NOT retroactively rebind it. That is exactly what happened here — the
// whole proxy-service suite had never been executed (its `test` script
// recursed into itself), and on first run `health.controller.spec.ts`'s
// module double leaked into `proxy.service.spec.ts`, whose own
// `globalThis.fetch` stub was therefore never reached: every proxy test saw
// health's last-configured `Promise.reject(new Error("network"))` and turned
// into a spurious 502.
//
// FIX: route every "@yoizen/observability" double through this ONE canonical
// `mock.module` call (the factory only delegates to a mutable indirection
// cell), and have every consuming spec file reassign the active fake via
// `setActiveTracedFetch` in its own `beforeEach`, so `tracedFetch` calls
// always land on THAT file's currently active fake — resolved at CALL TIME
// rather than at binding time.
import { mock } from "bun:test";

export type TracedFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

let activeTracedFetch: TracedFetchImpl = () =>
  Promise.resolve(new Response("{}", { status: 200 }));

/** Call in `beforeEach` so `tracedFetch` calls land on YOUR fake. */
export function setActiveTracedFetch(fn: TracedFetchImpl): void {
  activeTracedFetch = fn;
}

class FakeLogger {
  log() {}
  warn() {}
  error() {}
  debug() {}
  verbose() {}
}

mock.module("@yoizen/observability", () => ({
  tracedFetch: (...args: Parameters<TracedFetchImpl>) =>
    activeTracedFetch(...args),
  PinoLoggerService: FakeLogger,
}));
