# SPEC — Fix the dev-mode validator's stage-5 race (restore G-a iteration gates)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/architecture/`.
> Origin: user decision 2026-07-29 (Cowork session — rules audit follow-up).
> Engram topic: 'architecture/dev-mode-validator'.

## Goal

`./scripts/validate-dev-mode.sh --with-e2e` exits 0, deterministically. Every
manual-loop's G-a ITERATION gates (fast source-mounted feedback, ~2s reload)
come back to life — since 2026-07-16 all backend loops silently degraded to
commit-gates-only via the PRECONDITION escape hatch.

## User decisions (human boundary — do not reinterpret)

1. Fix the VALIDATOR, not the loops: the race is internal to
   `validate-dev-mode.sh` (twice diagnosed); `dev-mode.sh` itself works.
2. Determinism bar: the validator must pass twice consecutively before this
   loop's tasks may be checked off.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Scripts only — no service source changes in this loop. Bash follows the
  existing style of `scripts/validate-dev-mode.sh` (stages, exit-code
  contract).
- The fix must WAIT for observable readiness, never sleep a fixed guess:
  poll with a bounded timeout and log what it waited for.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (doc/code drift, cheap, every attempt)
./scripts/checks/doc-code-guards.sh
# G1 — the validator itself, twice (determinism bar, decision 2)
./scripts/validate-dev-mode.sh --with-e2e && ./scripts/validate-dev-mode.sh --with-e2e
```

Gate rules (self-contained): G1 is the acceptance — no dev-mode/G-a/G-b split
in this loop (it repairs that machinery, it cannot depend on it).

---

## Task queue

### T01 — Reproduce and pinpoint the race window (report task, no fix)

- Known symptom (recorded 2026-07-16 in `provisioning-manifest-gaps.md:524`,
  re-confirmed 2026-07-24 in `provisioning-manifest-gaps-4.md` Progress):
  stage 4's canary-revert triggers a second `bun --watch` reload; stage 5's
  e2e hits the API mid-reload (`jq: Cannot index number with string "name"`
  on the workflow LIST). The same e2e passes standalone with dev-mode on AND
  off.
- Instrument or observe: identify the exact window (what stage 4 changes,
  which process reloads, how long the API is inconsistent) and RECORD the
  evidence in this SPEC's Progress under "**T01 findings (recorded <date>):**",
  numbered, with log excerpts.

**Accept**
```
./scripts/validate-dev-mode.sh --with-e2e; test $? -ne 0  # still red, now explained
grep -n "T01 findings" manual-loops/architecture/dev-mode-validator-fix.md
```

### T02 — Close the window: readiness barrier between stage 4 and stage 5

- In `scripts/validate-dev-mode.sh`, after the canary-revert of stage 4:
  wait for the reloaded API to be observably ready before stage 5 starts —
  poll a cheap authenticated endpoint until it returns the expected SHAPE
  (not just 200), bounded timeout, verbose logging of attempts.
- No fixed sleeps (constraint). The barrier logs what it waited for and how
  long it took.
- If T01's findings point at a different mechanism, follow the findings —
  and note the deviation in Progress.

**Accept**
```
./scripts/validate-dev-mode.sh --with-e2e && ./scripts/validate-dev-mode.sh --with-e2e
```

### T03 — Retire the debt notes + docs

- Remove the "KNOWN STATE 2026-07-29 ... expect this skip" note from
  `manual-loops/connectors/connection-call-inspector.md`'s PRECONDITION (the
  anti-zombie rule itself STAYS in both templates and the SPEC).
- `DOCS/guides/dev-mode.md`: document the stage-4→5 readiness barrier and
  the historical race (dated).
- `cowork/INDEX.md` entry; Engram topic `architecture/dev-mode-validator`.

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -c "KNOWN STATE 2026-07-29" manual-loops/connectors/connection-call-inspector.md | grep -x 0
grep -n "dev-mode-validator" cowork/INDEX.md
```

---

## Progress

**T01 findings (recorded 2026-07-30):**

Method: two full `./scripts/validate-dev-mode.sh --with-e2e` runs (both exit 1,
same failure) with a read-only 0.5–1s probe of `GET /api/workflows` through the
gateway running alongside, plus two controlled experiments that replay stage 4's
canary edit OUTSIDE the validator (`dev-mode.sh` and the validator itself
untouched — no instrumentation was left in any repo file).

1. **What stage 4 changes, and what reloads.** Stage 4 appends
   `console.log("dev-mode-canary-<ts>")` to `services/workflow-service/src/main.ts`
   and, ~1s later, undoes it with `git checkout -- $CANARY_FILE`
   (`scripts/validate-dev-mode.sh:141,151`). `src/main.ts` is the entry of BOTH
   the worker Deployments AND the `workflow-service-api` ksvc, so **each of the
   two writes restarts the API's `bun --watch` process**. Isolated experiment
   (edit and revert separated by ~50s of proven-stable API), dev api pod
   `workflow-service-api-00090-deployment-6d6cdd9bd6-xzjks`:
   ```
   13:29:34.556  Nest application successfully started      <- pod start
   13:30:09.847  t01-exp3-1785418208                        <- canary APPEND (10:30:08)
   13:30:09.981  Nest application successfully started      <- reload #1
   13:31:02.768  Nest application successfully started      <- reload #2, from the REVERT (10:31:01)
   ```
   The prior diagnoses' claim "the canary-revert triggers a second reload" is
   CONFIRMED verbatim.

2. **How long the API is inconsistent.** During a reload the Knative
   queue-proxy cannot reach the user container and the gateway returns HTTP 502
   with a JSON *object*. Replay of stage 4's exact sequence (append, revert 1s
   later — the two reloads coalesce into one outage), probed every 0.5s:
   ```
   10:27:45 code=200 type=array keys=[9]
   10:27:45 code=502 type=object keys=["message","statusCode"]
            RAWBODY={"statusCode":502,"message":"dial tcp 127.0.0.1:3000: connect: connection refused\n"}
   10:27:46 code=502 ... (canary appended 10:27:45, reverted 10:27:46)
   10:27:47 code=502 ...
   10:27:47 code=200 type=array keys=[9]
   ```
   **Window ≈ 2.0–2.5s, opening on the edit and still open when stage 5 starts.**
   It is width-variable, not fixed: the same edit applied to an API pod that had
   been serving for ~40s produced a restart so fast (~1.3s, finding 1) that a
   0.25s probe saw no 502 at all. The validator always hits the WIDE (cold-pod)
   case — see finding 4.

3. **The parents' `jq: Cannot index number with string "name"` is exactly this
   502 body.** The e2e's workflow LIST consumer is
   `api GET /api/workflows | jq -r '.[] | select(.name | ...)'`
   (`scripts/e2e/http-workflow.sh:432`). Run `.[]` over
   `{"statusCode":502,"message":"..."}` and jq iterates the VALUES — the number
   `502` — then indexes it with `"name"`. Reproduced by the probe on every 502
   sample above (`jqerr=jq: error (at <stdin>:0): Cannot index number with
   string "name"`). Same window, different consumer: no separate mechanism.

4. **Nothing in the validator ever waits for the API.** Stage 3 waits only for
   `deployment/${DEPLOYS[0]}` = `workflow-service-worker`
   (`validate-dev-mode.sh:128`); stage 4 watches the canary nonce on that same
   worker Deployment (`RELOAD_TARGET`, line 137); stage 5 calls
   `./scripts/e2e/http-workflow.sh` on the very next line with zero wait
   (line 161). The ksvc `workflow-service-api` is therefore never observed at
   all, and its bun process is at its COLDEST (first transpile after the dev
   rollout, ~40s to first stable response in experiment 3) exactly when stage 5
   begins. Stage 4 legitimately reports `canary nonce logged by reloaded pod in
   1s` while the API is mid-restart.

5. **Today's actual stage-5 failure (both runs) is the same window, seen by
   provisioning-service instead of by jq** — matching the 2026-07-24 record in
   `provisioning-manifest-gaps-4.md`. The e2e's manifest plan/apply reaches
   provisioning-service, whose workflow lookups land in the 502 window:
   ```
   13:33:37.020 plan.workflow-client findByName: GET http://workflow-service-api.../workflows kind='workflow' name='e2e-http-agentflow-e2e-1785418416-12597'
   13:33:37.024 WARN PlanService plan: downstream lookup failed kind='workflow' ...: HTTP 502 from http://workflow-service-api.../workflows
   13:33:37.028 WARN PlanService plan: downstream lookup failed kind='workflow' name='e2e-http-log-...': HTTP 502 ...
   13:13:55.025 INFO PlanService plan: completed manifest='e2e-http-workflow' resources=2 preconditions=2   (run 1, same shape)
   ```
   Both workflows are dropped from plan AND apply, apply returns HTTP 200
   `appliedCount=2`, and the e2e dies on the consequence:
   ```
   [ERR] Manifest apply response missing an expected resource externalId
         (channel=aed00a6d-... agent=c88c8432-... workflow=<empty> agentWorkflow=<empty>)
   [FAIL] e2e-http-workflow.sh failed under dev mode
   ```

6. **Verdict: the race IS internal to the validator** (user decision 1 holds).
   Trigger, timing and ordering are all owned by `validate-dev-mode.sh`: it
   writes the file twice, watches the wrong process, and starts stage 5 with no
   readiness barrier. `dev-mode.sh` behaved correctly in every run (stages 6/7
   green: image+command restored on all three objects, annotations gone), and
   the e2e is green standalone.

7. **Two constraints this hands to T02.** (a) The barrier must poll the
   *gateway-facing* API for the expected SHAPE, not just liveness — during the
   window the answer is a well-formed HTTP 502 JSON object, and the caller that
   breaks first (provisioning-service's `findByName`) is not even the e2e's own
   curl. (b) It must require N CONSECUTIVE good samples after the revert: the
   append and the revert are two distinct reloads (finding 1), so a single 200
   can legitimately be observed in the gap between them.

8. **Out-of-scope robustness gap, recorded not fixed** (SPEC forbids service
   source changes here): `build-manifest-plan.ts:128-138` downgrades a failed
   downstream lookup to a `warn` + a `downstream_error` PRECONDITION and
   `continue`s, so apply proceeds and partially applies; `http-workflow.sh`'s
   stage 2/3 logs only `.resources[]` verdicts and never inspects
   `.preconditions`, so a signal that WAS present (`preconditions=2`) is
   discarded and the run fails later with a confusing message. Worth its own
   SPEC; closing the validator's window removes the trigger regardless.

- [x] T01 reproduce + pinpoint (report)
- [x] T02 readiness barrier
- [ ] T03 retire debt notes + docs

## Out of scope (explicit)

- Touching `dev-mode.sh` or any service source — the validator is the patient.
- Making G-a mandatory for admin-console (it has no dev-mode; the skip is by
  design, not debt).

## Human boundaries for this change

- Human approves this SPEC before the first run.
- If T01 reveals the race is NOT internal to the validator (contradicting the
  two prior diagnoses), STOP and re-plan with the human.
