# SPEC — Channel subject parsing: tests and token validation

> Task queue for the manual loop. One task at a time, gated by tests and dual review.
> Origin: user decision 2026-09-09 (Cowork session) — first run of the restored engine,
> kept under `manual-loops/examples/` as the reference SPEC for small, single-package loops.
> Engram topic: 'manual-loop/examples/channel-subject-parsing'.

## Goal

`packages/shared/src/channel.utils.ts` builds and parses the 8-token NATS subjects of
the messaging domain and has no unit tests. `parseChannelSubject` casts the channel,
provider and kind tokens (`parts[4] as Channel`) without checking them, so a subject
like `evt.t1.channel-service.messaging.whatsapp.foo.bar.v1` parses as valid. After this
loop: the four subject functions have data-driven tests, and `parseChannelSubject`
returns `null` for any channel, provider or kind outside the runtime lists.

## User decisions (human boundary — do not reinterpret)

1. `parseChannelSubject` keeps its signature (`… | null`). Its two callers
   (`workflow-service/…/trigger-consumer.service.ts`, `channel-service/…/send-command-consumer.service.ts`)
   must not change.
2. The runtime lists live in `channel.constants.ts`, next to the other channel
   constants; the union types in `channel.interfaces.ts` stay as they are.
3. Gate executor for this loop: `script-runner` (this is also a test of that role).

## Constraints (apply to every task)

- AGENTS.md is normative; these Constraints specialize it without weakening it.
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Pure functions only in `channel.utils.ts`: no I/O, no logging, no exceptions for
  expected failures (`null` is the existing typed failure of `parseChannelSubject`).
- Tests are data-driven (`describe`/`it` from `bun:test`, tables of cases), no mocks.
- No new dependencies. No changes outside `packages/shared`.

## Gates (the manual loop runs these verbatim, in order)

QA: none
Gate executor: script-runner

```
# G0 — repo guards (KISS, every attempt)
./scripts/checks/doc-code-guards.sh
# G1 — shared typecheck (cheapest failure first)
cd packages/shared && bunx tsc -p tsconfig.json --noEmit
# G2 — shared tests
cd packages/shared && bun test
```

All three are ITERATION gates. There is no COMMIT GATE: this package has no image.

---

## Task queue

### T01 — Unit tests for the channel subject helpers

- **Allowed write paths:** `packages/shared/test/unit/channel.utils.spec.ts` (new file).
- **Non-goals:** no change to `src/`; do not test private helpers; do not add fixtures
  outside the spec file.
- Cover `buildChannelSubject`, `parseChannelSubject`, `buildWebhookIngressSubject`,
  `parseWebhookIngressSubject` (all in `packages/shared/src/channel.utils.ts`).
  Precedent for style: `packages/shared/test/unit/envelope.utils.spec.ts`.
- Required cases, as tables:
  - round trip: `parseChannelSubject(buildChannelSubject(t, c, p, k))` returns
    `{ tenant, channel, provider, kind, version: "v1", producer: "channel-service" }`
    for every combination of `channel ∈ {telegram, http, e2e-tests}` and
    `kind ∈ {received, sent, delivered, read, failed, send}`;
  - explicit version: `buildChannelSubject(…, "v2")` ends in `.v2` and parses back;
  - rejections returning `null`: 7 tokens, 9 tokens, wrong prefix (`cmd.` instead of
    `evt.`), wrong producer, wrong domain, empty string;
  - `buildWebhookIngressSubject` / `parseWebhookIngressSubject` round trip and the
    same structural rejections.
- Do NOT add cases for unknown channel/provider/kind tokens: today they parse, and
  that behavior changes in T02, whose tests belong to T02.

**Accept**
```
cd packages/shared && bun test test/unit/channel.utils.spec.ts
```

### T02 — `parseChannelSubject` rejects unknown channel, provider and kind tokens

- **Allowed write paths:** `packages/shared/src/channel.constants.ts`,
  `packages/shared/src/channel.utils.ts`, `packages/shared/test/unit/channel.utils.spec.ts`.
- **Non-goals:** no signature change; no change to the union types in
  `channel.interfaces.ts`; no change to `parseWebhookIngressSubject`; no callers touched.
- In `channel.constants.ts` add three runtime lists, `readonly` and typed against the
  existing unions so that a token added to one side without the other fails typecheck:
  `CHANNELS: readonly Channel[]`, `CHANNEL_PROVIDERS: readonly ChannelProvider[]`,
  `MESSAGE_KINDS: readonly MessageKind[]`, with exactly the values of the unions in
  `channel.interfaces.ts` (channels and providers: `telegram`, `http`, `e2e-tests`;
  kinds: `received`, `sent`, `delivered`, `read`, `failed`, `send`).
- In `parseChannelSubject`, replace the three `as` casts with membership checks against
  those lists; any miss returns `null`. Everything that parsed before and is in the
  lists must still parse identically (T01's round-trip table is the regression).
- Extend `channel.utils.spec.ts` with a rejection table: unknown channel (`whatsapp`),
  unknown provider (`meta`), unknown kind (`bounced`), and one case where all three are
  wrong. Add one test that `CHANNELS`, `CHANNEL_PROVIDERS` and `MESSAGE_KINDS` are
  exported from the package index if the index re-exports channel constants (check
  `packages/shared/src/index.ts` first; if it does not, do not add the export — report it).

**Accept**
```
cd packages/shared && bun test test/unit/channel.utils.spec.ts && bunx tsc -p tsconfig.json --noEmit
```

---

## Progress

- [x] T01 unit tests for the channel subject helpers
- [ ] T02 `parseChannelSubject` rejects unknown tokens

Token ceiling: 5 M per task, every thread including the orchestrator. Crossing it
blocks the task like an exhausted attempt budget.

- Attempts: T01 2/4; T02 0/4.
- T01 completed 2026-09-10: 34 table-driven tests added; production code unchanged.
  T02 remains unstarted; no blocked work. Estimated run usage below 100,000 / 5,000,000
  tokens across threads; exact accounting unavailable.
- Attempt 1: all gates exited 0; both reviewers REJECTED the standalone explicit-version
  case because T01 requires tables. Attempt 2 converted it to a table, preserving assertions.
  Both independent reviewers returned APPROVED on the unchanged attempt-2 diff.
- Validation (script-runner, commands run from repository root; Bun 1.3.1):

  | Gate / exact command | Attempt 1 | Attempt 2 | Trimmed output |
  |:---|:---|:---|:---|
  | G0: `./scripts/checks/doc-code-guards.sh` | exit 0 | exit 0 | `KISS doc/code guards passed.`; `di-imports guard: CLEAN (0 files scanned, git-modified only)` |
  | G1: `cd packages/shared && bunx tsc -p tsconfig.json --noEmit` | exit 0 | exit 0 | No output |
  | G2: `cd packages/shared && bun test` | exit 0 | exit 0 | `418 pass`, `0 fail`, `783 expect() calls`; 22 files |
  | Accept: `cd packages/shared && bun test test/unit/channel.utils.spec.ts` | exit 0 | exit 0 | `34 pass`, `0 fail`, `35 expect() calls`; 1 file |

- Implementer independently ran Accept on both attempts: exit 0, 34 pass, 0 fail.
  No gates skipped or command fallbacks. No affected build, dependency installation,
  image gate, or service rebuild for this test-only task. Engram connector unavailable;
  this SPEC preserves the result under the declared topic.

## Out of scope (explicit)

- Changing the return type to `Result` — its two callers would change; separate SPEC.
- Validating the tenant token format — no rule exists for it today.
- Any other helper in `packages/shared`.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human reviews the two commits before anything is pushed.
