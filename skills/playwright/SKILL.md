---
name: playwright
description: >
  Browser E2E testing for THIS platform (platform-cluster): the repo's Playwright
  config, the Angular Material locator helpers the existing suite uses, the
  `E2E_*` environment contract, and the sequential + idempotent execution model.
  Trigger: When writing, running or debugging Playwright specs under `e2e/`,
  admin-console browser flows, or end-to-end UI tests.
license: Apache-2.0
metadata:
  author: Yoizen
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "playwright"
    - "e2e test"
    - "end-to-end"
    - "browser test"
---

> **Sources of truth (read the code, not this file, when they disagree):**
> - `playwright.config.ts` — the only Playwright config in the repo.
> - `e2e/sales-agent-setup.spec.ts` — the reference implementation (845 lines).
>   The conventions in §3 are taken from it verbatim. The rules in §5 marked
>   **new-spec-only** are NOT — the reference predates them and still contains
>   the pattern they forbid; do not copy those parts.
> - `README.md` — cluster bring-up, tenant seed, console URL.
>
> This skill documents THIS repo's setup only. It is not a Playwright tutorial —
> for the framework's own API, read the upstream docs.

## Activation Contract

Apply this skill when adding or changing a spec under `e2e/`, running the browser
suite, or debugging a flaky admin-console E2E flow.

## Hard Rules

- **One worker, sequential.** `workers: 1` and `fullyParallel: false`
  (`playwright.config.ts:13,16`). The comments state why: *"Sales flow is
  sequential — must run in order"* and *"One worker — tests share state (login,
  entities)"*. Specs may depend on entities created by earlier tests in the file.
- **Every test must be idempotent.** The suite is re-run against a live dev
  cluster without a reset, so a test checks whether its entity already exists and
  returns early if so (`e2e/sales-agent-setup.spec.ts:12-13`, pattern at
  `:147-157`).
- **Config comes from `E2E_*` env vars with dev defaults**, never hardcoded
  inline (`spec:16-19`): `E2E_BASE_URL` (`http://localhost:4200`), `E2E_EMAIL`
  (`yclawd@demo.io`), `E2E_PASSWORD` (`admin123`), `E2E_TENANT` (`acme`). Those
  defaults are exactly what `./setup-tenant.sh` seeds (`README.md`, "Seed the tenant").
- **Use the Material helpers, not raw CSS.** Angular Material renders the native
  `<input>` inside `<mat-form-field>` and puts overlays at the body level, so
  label-based selectors need the helpers in the reference spec (see §3).
- **Chromium only.** One project is configured (`playwright.config.ts:28-33`);
  do not add browsers without a reason to maintain them.
- The suite targets a **running admin-console against a live dev cluster**. It is
  not hermetic and does not stub the backend.

## Decision Gates

| Situation | Action |
|---|---|
| Run the whole suite | `npx playwright test` (`playwright.config.ts:7`) |
| Run one suite | `npx playwright test e2e/sales-agent-setup` (`:8`) |
| Watch it in a browser | `npx playwright test --headed` (`:9`) |
| Point at the in-cluster console instead of `ng serve` | `E2E_BASE_URL=http://admin-console.platform-services-dev.dev.local npx playwright test` (`README.md`, "Access") |
| Fill a `matInput` by label | `fillMatInput(page, label, value)` (`spec:28-40`) |
| Pick a `mat-select` option | `selectMatOption(page, label, optionText)` (`spec:47-61`) |
| Add tags to a chip input | `fillChips(page, label, tags)` (`spec:66-73`) |
| Wait for the SPA shell | `waitForAppReady(page)` (`spec:79-85`) |
| Dismiss a leftover dialog | `closeDialogIfOpen(page)` (`spec:91-97`) |
| Assert a success toast | `expectSnackBar(page, text)` (`spec:102-105`) |
| Authenticate | `login(page)` in `beforeEach` (`spec:109-130`, used at `:135-139`) |

---

## 1. The config

`playwright.config.ts` — the whole file is 34 lines; the parts that constrain how
you write specs:

| Setting | Value | Line |
|---|---|---|
| `testDir` | `./e2e` | `:12` |
| `fullyParallel` | `false` — *"Sales flow is sequential — must run in order"* | `:13` |
| `forbidOnly` | `!!process.env.CI` — a stray `test.only` fails CI | `:14` |
| `retries` | `1` on CI, `0` locally | `:15` |
| `workers` | `1` — *"tests share state (login, entities)"* | `:16` |
| `baseURL` | `process.env.E2E_BASE_URL ?? "http://localhost:4200"` | `:20` |
| `trace` / `screenshot` / `video` | on-first-retry / only-on-failure / retain-on-failure | `:21-23` |
| `actionTimeout` / `navigationTimeout` | 15 s / 30 s | `:24-25` |
| projects | `chromium` only (`Desktop Chrome`) | `:28-33` |

`@playwright/test ^1.60.0` is a root devDependency (`package.json:5`). There is no
npm script — the root `package.json` defines none, so invoke the binary directly.

## 2. Prerequisites

The suite drives a real console against a real cluster. Before running:

0. **Install the browser.** Nothing in this repo vendors Playwright browsers and
   no script installs them, so a fresh clone fails with *"Executable doesn't
   exist"* until you run it once:

   ```bash
   npx playwright install chromium
   ```

   Chromium only — it is the single configured project
   (`playwright.config.ts:28-33`).
1. **Cluster up and seeded.** `./setup-tenant.sh` is idempotent and creates
   tenant `acme` + admin `yclawd@demo.io` (`README.md`, "Seed the tenant") — the same values
   the spec defaults to. A cluster reset wipes the PVCs, so re-seed after one.
2. **A console to point at**, either:
   - `cd services/admin-console && pnpm start` (`ng serve`,
     `services/admin-console/package.json:6`) → `http://localhost:4200`, the
     config default; or
   - the in-cluster console at
     `http://admin-console.platform-services-dev.dev.local` (`README.md`, "Access"),
     via `E2E_BASE_URL`.

`README.md`'s "Smoke test" section places these browser specs alongside the other e2e paths:
`scripts/e2e/http-workflow.sh` for the HTTP workflow smoke, the Playwright specs
under `e2e/` for browser flows.

## 3. House conventions (from the reference spec)

**Material locators.** `fillMatInput` (`spec:28-40`) finds the
`mat-form-field` that *contains* the label text, then targets the native
`input, textarea` inside it — the input is not a direct child, and clicking the
field first is what focuses it. `selectMatOption` (`spec:47-61`) clicks the
`mat-select` trigger and then the `mat-option`, which renders in a **CDK overlay
at the body level**, not inside the field. `fillChips` (`spec:66-73`) types each
tag and presses Enter.

**Readiness over sleeps.** `waitForAppReady` (`spec:79-85`) waits for
`app-shell, app-login, .login-container, [class*="sidebar"]` — the shell or the
login card, whichever the route lands on. Tests also use
`page.waitForLoadState("networkidle")` before probing a list page (`spec:145`).

**Snack bars and dialogs.** `expectSnackBar` (`spec:102-105`) matches
`mat-snack-bar-container, .mat-mdc-snack-bar-container` (both the old and MDC
class names). `closeDialogIfOpen` (`spec:91-97`) presses Escape and waits for
`.cdk-overlay-backdrop` to detach — call it when a previous step may have left an
overlay open.

**Login.** `login(page)` (`spec:109-130`) goes to `/login`, fills Email and
Password via `fillMatInput`, fills `Tenant ID` **only if that field is visible**,
clicks the `sign in` button by role, then waits for `**/dashboard`. It runs in
`beforeEach` together with `test.setTimeout(180_000)` (`spec:135-139`) — these
flows are long.

**Defensive optional steps.** The suite's most pervasive idiom — 35 occurrences
— is `if (await locator.isVisible().catch(() => false))`. `isVisible()` already
returns `false` for zero matches without throwing; the `.catch(() => false)` is
what absorbs the cases that DO reject — a strict-mode violation when the locator
matches several elements, and page/context-closed races — so the whole step
degrades to "skip" instead of failing the test.
Use it for anything the UI may or may not render: the login `Tenant ID` field
that only appears in some backend states (`spec:119-122`), a leftover overlay
backdrop (`:93`), a provider dropdown that varies by connector type (`:568`), an
adapter option that may already be selected (`:720`). Do NOT use it to paper over
a step that must happen — an assertion that silently becomes a no-op is worse
than a failing one.

**Idempotency.** The pattern (`spec:147-157`): navigate to the list page, locate
a card filtered by the entity name, and if visible push a `test.info()`
annotation and `return` instead of creating it again.

## 4. Writing a new spec

1. Put it in `e2e/` so `testDir` picks it up (`playwright.config.ts:12`).
2. Read `E2E_*` env vars with dev defaults at the top of the file, mirroring
   `spec:16-19`.
3. Copy the helpers you need from `e2e/sales-agent-setup.spec.ts` — they are
   file-local by design; there is no shared helper module yet. If you find
   yourself copying all of them, that is the signal to extract one (and to say
   so in your report).
4. `test.beforeEach` → `test.setTimeout(...)` + `await login(page)`.
5. Make every creating test check-then-create so a second run is a no-op.
6. Assert on user-visible outcomes (snack bar text, the entity appearing in a
   list), not on network calls.
7. Run it twice in a row. If the second run fails, it is not idempotent.

## 5. What NOT to do

- **Do not raise `workers` or set `fullyParallel: true`.** Tests share login
  state and created entities (`playwright.config.ts:13,16`); parallelism corrupts
  both and produces failures that do not reproduce serially.
- **Do not hardcode credentials, tenant or URLs** beyond the documented dev
  defaults — read them from `E2E_*` so the suite can point at another
  environment.
- **Do not hand-write CSS selectors for Material widgets** when a helper exists.
  Targeting `input[formcontrolname=...]` or a nested `.mat-mdc-*` class breaks on
  every Material upgrade; the label-based helpers do not.
- **Do not add `test.only`** — `forbidOnly` fails the CI run
  (`playwright.config.ts:14`).
- **Do not add fixed `waitForTimeout` sleeps** (**new-spec-only**). Use the
  readiness helpers or Playwright's auto-waiting assertions instead. The
  reference spec predates this rule and still contains 22 of them (`spec:180`,
  `:257`, `:347`, `:410`, …) — they are legacy, not the house pattern, so do not
  copy them when you lift helpers from that file.
- **Do not assume a clean database.** Assume the previous run's entities are
  still there.

## References

- `playwright.config.ts` — config (testDir, workers, baseURL, chromium project)
- `e2e/sales-agent-setup.spec.ts` — reference implementation: helpers `:28-105`,
  login `:109-130`, idempotent test pattern `:147-157`
- `README.md` — sections "Seed the tenant", "Access", "Smoke test"
- `services/admin-console/package.json` — `start` = `ng serve` (`:6`)
- `skills/yz-ui/SKILL.md` — the UI patterns these specs drive
