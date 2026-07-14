// Shared `"nats"` module double for `src/activities/_shared/event-publisher.ts`
// ONLY (`invoke-request-publisher.ts` has its own independent `"nats"` mock in
// `invoke-request-publisher.spec.ts` — nothing else imports that module, so it
// never hits the problem this file solves).
//
// WHY THIS EXISTS (bun `mock.module` + ESM singleton interaction):
// `event-publisher.ts` is imported by TWO spec files — `event-publisher.spec.ts`
// (directly) and `endpoint-call.activity.spec.ts` (transitively, via the real
// `endpoint-call.activity.ts` it tests). `bun test` runs every spec file in ONE
// process and caches ES modules by resolved path: `event-publisher.ts` is only
// ever EVALUATED ONCE across the whole run, no matter how many spec files
// `await import(...)` it afterwards. Its top-level `import { connect } from
// "nats"` binding is fixed FOREVER to whatever `"nats"` module was registered
// via `mock.module("nats", ...)` at that ONE evaluation moment — a LATER
// spec file calling `mock.module("nats", anotherFactory)` does NOT retroactively
// rebind it. `bun test`'s file execution order is not alphabetical and not
// otherwise controllable, so whichever of the two spec files happens to run
// first "wins" the binding — leaving the OTHER file's own `publishSpy` assertions
// permanently seeing zero calls (confirmed empirically; see git history for the
// two failed local attempts before this fix).
//
// FIX: route the mocked `nats.connect(...).jetstream().publish` through a
// mutable INDIRECTION cell (`activePublishSpy`) that every consuming spec file
// reassigns via `setActivePublishSpy` before its own tests run. Because the
// indirection is resolved at CALL TIME (not at module-evaluation/binding time),
// it doesn't matter which spec file's `mock.module("nats", ...)` call was the
// one bun actually used to freeze `event-publisher.ts`'s import — every publish
// call still lands on whichever spy is CURRENTLY active for the running file.
import { mock } from "bun:test";

type PublishSpy = ReturnType<typeof mock>;

let activePublishSpy: PublishSpy = mock(async () => ({ seq: 1 }));

/** Call in `beforeEach`/before importing the unit under test so this file's calls land on YOUR spy. */
export function setActivePublishSpy(spy: PublishSpy): void {
  activePublishSpy = spy;
}

function fakeHeaders(): {
  set: (k: string, v: string) => void;
  get: (k: string) => string | undefined;
} {
  const store = new Map<string, string>();
  return {
    set: (k: string, v: string) => {
      store.set(k, v);
    },
    get: (k: string) => store.get(k),
  };
}

mock.module("nats", () => ({
  connect: mock(async () => ({
    isClosed: () => false,
    jetstream: () => ({
      publish: (...args: unknown[]) =>
        (activePublishSpy as unknown as (...a: unknown[]) => unknown)(...args),
    }),
  })),
  headers: fakeHeaders,
}));
