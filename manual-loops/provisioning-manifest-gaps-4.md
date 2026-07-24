# SPEC — provisioning manifest gaps 4: `services[].env[]` secretRef + ref substitution (k8s-native)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/declarative-provisioning.md` (shipped — manifest
> v1, `provisioning-service`, secrets broker, apply engine); `manual-loops/
> provisioning-manifest-gaps.md` (T01-T07 shipped); `manual-loops/
> provisioning-manifest-gaps-2.md` (T01-T06 + T08 shipped, T05 shipped
> PLAIN-STRINGS-ONLY per a HUMAN RULING this SPEC revisits — see decision 1);
> `manual-loops/provisioning-manifest-gaps-3.md` (T01-T05 shipped, 12/12
> samples declarative).
> Origin: `manual-loops/crm-support-telegram.md` T04 — the `priority-scorer`
> hosted service's `services[].env[]` block needs (a) `YOIZEN_EMAIL`/
> `YOIZEN_PASSWORD` as secret-bound values (the scorer's own platform login
> credentials) and (b) `HUBSPOT_CONNECTOR_ID`/`HUBSPOT_DEALS_ENDPOINT_ID`/
> `HUBSPOT_TICKETS_ENDPOINT_ID`/`HUBSPOT_CREATE_TICKET_ENDPOINT_ID` resolved
> from the SAME apply's `demo-hubspot` connector by ref — neither is
> expressible under the current `serviceEnvVarSchema = { name, value: string
> }` (plain literals only). Human decision 2026-07-24: the crm loop PAUSES
> before T04; this SPEC closes the gap platform-side first. See
> `manual-loops/crm-support-telegram.md`'s Progress checklist for the pause
> note.
> Engram topic: 'platform/provisioning-manifest-gaps-4'.

## Goal

Extend `services[].env[]` so a hosted service's env var `value` can be, per
entry:

1. **A literal string** (unchanged from `provisioning-manifest-gaps-2.md`
   T05) — e.g. `YOIZEN_TENANT`.
2. **`{ secretRef: <binding-name> }`** — resolved through the SAME secrets
   broker every other `secretRef` consumer in this lineage uses (channel
   `accessToken`, connector `auth.*`), scope `kind: "service", owner: <service
   name>`. **HOW the resolved value reaches the running container is an OPEN
   design question — see decision 1. It is NOT simply "mirror connector auth
   verbatim"** (that would resolve to plaintext and bake it into the Knative
   spec, which a prior human ruling on THIS EXACT FIELD already rejected once
   — see decision 1 for the full history).
3. **A symbolic ref into the SAME apply's connectors** — two shapes:
   - `{ connectorRef: <connector-name> }` — the connector's own id (e.g.
     `HUBSPOT_CONNECTOR_ID`). Resolves via the EXISTING apply-time
     `resolvedIds` map (`build-substituted-resource.ts`) — no new mechanism
     needed for this shape, see Prior art.
   - `{ connectorRef: <connector-name>, endpointMethod: <HTTP method>,
     endpointPath: <path> }` — ONE of that connector's endpoint ids (e.g.
     `HUBSPOT_DEALS_ENDPOINT_ID`), matched the SAME way
     `connectors-writer.ts` already matches endpoints: by `(method, path)`,
     never a manifest-declared endpoint name (endpoints have no `name`
     field — see Prior art). **This shape has NO existing resolution
     mechanism to reuse — endpoints are not independently-addressable
     manifest resources with their own `resolvedIds` entry. T03 proposes the
     smallest new mechanism that fits (a live re-fetch of the already-
     created/updated connector), not a general-purpose extension.**

End goal: the exact crm-support-telegram T04 use case — a `services[].env[]`
block carrying 2 `secretRef`s and 4 connector/endpoint refs — validates,
plans, applies (resolving every entry correctly, values never logged or
persisted in plaintext where decision 1 rules that out), and noops on the
second apply.

## User decisions (human boundary — do not reinterpret)

1. **OPEN RULING — secretRef resolution mechanism for `services[].env[]`.
   Human decides before T04 starts (T01-T03 do not depend on this ruling —
   see each task's scope).** Two options, both fully investigated below; this
   SPEC's default/recommendation is Option B, but the coordinator's original
   framing of this gap ("resolved through the secrets broker like connector
   auth already does") describes Option A, so the conflict must be surfaced
   explicitly rather than silently resolved by the SPEC author.

   **RULED (human, 2026-07-24): Option B — k8s-native `valueFrom.secretKeyRef`.**
   T04 is unblocked and implements Option B exactly as specified below;
   Option A stays documented as the rejected alternative.

   **History** (why this is not a fresh question): `provisioning-manifest-
   gaps-2.md` T05 attempted EXACTLY Option A on this EXACT field once already
   (2026-07-16). Attempt 1 shipped a `string | { secretRef }` shape where the
   secretRef branch resolved to plaintext inside `provisioning-service` and
   `registry-services-writer.ts` shipped it in the `envVars` request body. A
   reviewer proved this bakes the literal secret into the Knative spec
   (etcd-persisted, kubectl-visible) — contradicting `declarative-
   provisioning.md` decision 7 verbatim: *"Hosted services receive their
   bound secrets k8s-natively (env from the Secret in their Knative spec) —
   user code sees plain env vars"* (`manual-loops/declarative-
   provisioning.md:51-52`, a FOUNDING decision, not a later addition). HUMAN
   RULING then (`provisioning-manifest-gaps-2.md:650-658`): PLAIN STRINGS
   ONLY, secretRef branch REMOVED, deferred as an explicit FOLLOW-UP
   (`provisioning-manifest-gaps-2.md:662-664`): *"k8s-native secretKeyRef env
   design — needs its own decision round (provisioning ensures the k8s
   Secret; registry/knative-builder emits valueFrom.secretKeyRef; touches
   registry-service)."* This SPEC is that decision round.

   **Option A — plaintext resolution (mirrors connector/channel auth 1:1).**
   `registry-services-writer.ts` resolves each `{ secretRef }` env entry
   through `Iln`/the broker (same call shape as
   `connectors-writer.ts`'s `resolveConnectorAuth`,
   `registry-services-writer.ts:228-266`-equivalent) and sends the plaintext
   value in the EXISTING `envVars: Record<string,string>` body
   (`registry-services-writer.ts:132-149`) — smallest possible diff, touches
   ONLY `provisioning-service` (no `registry-service` change). **Directly
   re-does what a human already reversed for a proven security reason** (see
   History) — choosing this option requires an EXPLICIT new ruling that
   overrides the 2026-07-16 one, not a silent default.
   - Trade-off if chosen: the literal secret value lands in
     `registered_services.env_vars` (Postgres JSONB,
     `services/registry-service/src/modules/services/services.postgres.repository.ts`)
     AND the live Knative `Service` object (etcd, `kubectl get ksvc -o yaml`
     visible to anyone with read on the tenant namespace) — a materially
     WORSE exposure surface than every other secretRef consumer in this
     platform, all of which keep the resolved value inside a single HTTP
     request/response and never persist it outside the k8s Secret the broker
     itself manages.

   **Option B — k8s-native `valueFrom.secretKeyRef` (RECOMMENDED —
   matches the founding decision 7 and the recorded FOLLOW-UP).**
   `provisioning-service` never resolves a service-scoped `secretRef` to
   plaintext at all: it only verifies the binding EXISTS (`ISecretsStore`/the
   broker, scope `kind: "service", owner: <service name>` — the SAME
   `psec-<kind>-<owner>` k8s Secret every other resource kind already uses,
   `secret-resource-name.ts:29-31`, confirmed ALREADY namespaced identically
   to where `registry-service` deploys its Knative Services — see Prior art)
   and passes `registry-service` a REFERENCE:
   `{ name: psec-service-<owner>, key: <secretRef-binding-name> }`.
   `registry-service`'s `knative-builder.ts` gains a new container-env
   variant that emits k8s's native
   `{ name, valueFrom: { secretKeyRef: { name, key } } }` instead of
   `{ name, value }`. No plaintext ever crosses `provisioning-service` ->
   `registry-service` -> Knative spec; k8s itself injects the value at pod
   start, the SAME mechanism decision 7 always intended. Touches BOTH
   `provisioning-service` (existence-check call, new env-shape passthrough)
   AND `registry-service` (DTO + `knative-builder.ts` + the Knative apply
   call) — a real, if small, second-service change; gates below add
   `registry-service`'s own test+rebuild gates for exactly this reason.
   - Verified feasible, not speculative: `registry-service`'s Knative
     Services deploy into `tenantKubernetesNamespaceName(tenantId,
     environment)` (`services/registry-service/src/modules/services/
     services.service.ts:60-61,106`) — the IDENTICAL namespace helper
     `k8s-secrets-store.ts:82-85` uses for `psec-*` Secrets. Same namespace
     means a plain in-namespace `secretKeyRef` (no cross-namespace secret
     copying, no additional RBAC grant beyond what already exists) resolves
     it live.

   Whichever option the human rules, it is recorded here per-ruling in
   Progress (mirrors `provisioning-manifest-gaps-2.md` T05's own two-round
   Progress entry) — this SPEC does NOT silently implement its own
   recommendation without that explicit sign-off, per the "OPEN ruling" tag
   above.

2. **`{ connectorRef }` (whole-connector) and `{ connectorRef,
   endpointMethod, endpointPath }` env values are NOT gated by decision 1** —
   they carry no secret material, resolve via ordinary apply-time
   substitution (T02/T03), and may proceed independent of the secretRef
   ruling's timeline.
3. Additive-only schema evolution, unchanged from all three parent SPECs:
   `serviceEnvVarSchema.value` widens from `z.string()` to a union that still
   accepts a bare string — every manifest declaring only literal `env`
   values (all 12 shipped manifests; none currently declare any `env` at
   all, confirmed by `grep -L 'env:' integrations/*/*/manifest.yaml` at T01
   time) keeps validating and noop-reapplying.
4. No prune/delete semantics — unchanged (inherited). `env` entries stay
   create-or-update (full-map resend) only, matching the existing
   `buildEnvVars` passthrough contract.
5. Secret VALUES never appear in logs, plan output, the manifest file, or
   (per whichever option decision 1 selects) anywhere they did not already
   appear before this SPEC. Automatic reviewer rejection on any violation.
6. Comparable-fields/noop semantics: `serviceComparable` already projects
   `envNames` ONLY (`comparable-fields.ts:425,444` — sorted `.map(envVar =>
   envVar.name)`, no value comparison on either side) — a `{ secretRef }`/
   `{ connectorRef }`-shaped `value` does not change the entry's `.name`, so
   the EXISTING comparable already satisfies "an env var resolved from a ref
   must still noop on the second plan" with ZERO changes to
   `comparable-fields.ts` or `desired-fields-of-resource.ts`. T01 adds a
   regression test PROVING this (do not silently assume it holds — verify
   it against the widened schema type).
7. Endpoint refs resolve by `(method, path)`, never a manifest-declared
   endpoint name — `connectorEndpointSchema` has no `name` field
   (`manifest.schema.ts:273-280`, only `label`/`method`/`path`/`cache`), and
   `connectors-writer.ts` already matches/reconciles endpoints the same way
   (`current.endpoints.some(e => e.method === ep.method && e.path ===
   ep.path)`, gaps.md T02 precedent) — T03 mirrors this exactly, does not
   invent an endpoint-naming scheme.
8. Delivery method: manual-loop (this SPEC), not SDD — unchanged.
9. Any dependency this loop finds that still cannot be expressed after T01-T04
   ship: stop and escalate — do not approximate, do not invent a further gap
   kind without a new human decision round (inherited boundary).

## Prior art (verified 2026-07-24 — REUSE, do not duplicate)

- `packages/shared/src/provisioning/manifest.schema.ts:539-570` —
  `serviceEnvVarSchema` = `{ name: string, value: string }` (`.strict()`),
  with the FULL history of the gaps-2 T05 reversal in its own header comment
  (lines 543-562) — T01 (this SPEC) rewrites this comment, does not delete
  the history it documents. `serviceSchema.env`
  (`manifest.schema.ts:632`) — `z.array(serviceEnvVarSchema).optional()`.
- `packages/shared/src/provisioning/manifest.schema.ts:273-280` —
  `connectorEndpointSchema` (`label`/`method`/`path`/`cache`, NO `name`
  field) — confirms decision 7's "match by (method,path)" is the only
  addressing scheme that exists for an endpoint.
- `services/provisioning-service/src/modules/apply/infrastructure/
  registry-services-writer.ts:126-149` — `buildEnvVars()`, the CURRENT plain-
  string-only passthrough T01-T04 extend; its header comment (lines 10-20)
  IS the gaps-2 T05 ruling text this SPEC's decision 1 quotes and revisits.
- `services/provisioning-service/src/modules/apply/infrastructure/
  connectors-writer.ts:228-266` — `resolveConnectorAuth`/`resolveField`, the
  EXACT broker-resolution shape Option A (decision 1) would mirror
  (`secretResolver.resolve({ tenantId, kind, owner, secretName,
  correlationId })`, never logs the resolved value).
- `services/provisioning-service/src/modules/secrets/lib/
  secret-resource-name.ts:29-31` — `secretResourceName(kind, owner) =>
  "psec-<kind>-<owner>"` — the ONE source of truth for the k8s Secret name
  ANY option needs (Option B references it directly by name; Option A's
  broker call resolves through it internally either way).
- `services/provisioning-service/src/modules/secrets/infrastructure/
  k8s-secrets-store.ts:77-142` — `createK8sSecretsStore`, namespace =
  `tenantKubernetesNamespaceName(tenantId, PLATFORM_ENVIRONMENT)`
  (line 82-85) — Option B's namespace-match proof (see decision 1).
- `services/provisioning-service/src/modules/secrets/domain/
  secret-broker.interfaces.ts` — `ISecretsBroker`/`ResolveSecretRequest`/
  `ActingResource` (`kind`, `owner`) — scope `kind: "service"` is ALREADY a
  valid `ResourceKind`/`SecretScopeKind` member (see next citation), so NO
  broker-side plumbing is needed for either option, only a NEW CALLER.
- `sdk/src/cli/valid-scope-kinds.ts:52-59` — `VALID_SCOPE_KINDS` ALREADY
  includes `"service"` (unlike `"skill"`/`"systemVariable"`, which are
  DELIBERATELY omitted as inert) — `client.secrets.put({..., scope: {kind:
  "service", owner: <name>}})` is ALREADY a legal call today; this SPEC adds
  the first CONSUMER of that binding, not the binding capability itself.
- `packages/shared/src/provisioning/validate-structural-rules.ts:33-67`
  (`connectorAuthSecretRefs`) and `:74-105` (`mcpServerAuthSecretRefs`) — the
  exact per-kind secretRef-extraction-for-`checkSecretRef` pattern T01
  mirrors with a NEW `serviceEnvSecretRefs` function; `checkSecretRef` itself
  (`:443-475`) is REUSED verbatim (expects `{path, secretRef}` pairs,
  already kind-agnostic). `checkRefResolution` (`:237-441`) currently has NO
  `service` branch at all — `manifest.spec.services` is read once for
  `serviceNames` (`:243`, used only by the workflow `serviceRef` case) but
  never iterated for the service's OWN nested refs — T01 adds that iteration
  the same way the existing `channels.forEach`/`connectors.forEach` blocks
  do (`:254-282`).
- `packages/shared/src/provisioning/collect-symbolic-refs.ts` (the PLAN-TIME
  generic walker — a different file from the apply-time
  `substitute-symbolic-refs.ts` under `provisioning-service`, do not
  conflate the two). `collectSymbolicRefs(manifest.spec, "spec")` — called by
  `gather-secret-references.ts:25` over the WHOLE `manifest.spec` tree
  (unlike the apply-time `substitute-symbolic-refs.ts` walker, which is
  restricted to `workflow.definition`/`agent.profile`) — recognizes any
  `secretRef`-named KEY with a string value AT ANY NESTING DEPTH, with no
  per-kind allowlist. Once `serviceEnvVarSchema.value` allows a nested
  `{ secretRef }` object, `gatherSecretReferences` (the PLAN-TIME
  `missing_secret` informational precondition, `build-manifest-plan.ts`)
  picks up a service-scoped `secretRef` occurrence AUTOMATICALLY — CONFIRMED
  via `parse-owning-resource.ts:10-16`'s `SECTION_TO_KIND` map, which
  ALREADY contains `services: "service"` (added for the workflow
  `serviceRef` case, but generically keyed, so it resolves a
  `spec.services[N].env[M].secretRef` path's owning resource correctly with
  ZERO changes to `parse-owning-resource.ts`/`gather-secret-references.ts`).
  T01 adds a regression test proving this (do not assume — verify), not new
  wiring.
- `services/provisioning-service/src/modules/apply/lib/
  substitution-allowlist.ts:1-141` — `SUBSTITUTION_ALLOWLIST`/
  `ALLOWLISTED_SUBSTITUTION_KEYS`, the generic argKey->refType map the
  `workflow.definition`/`agent.profile` walker consumes. **T02 deliberately
  does NOT add an entry here** — every existing/prior entry's `argKey` is a
  SPECIFIC, single-purpose argument name (`accountId`, `adapterId`,
  `catalog_skill_id`, ...) inside a FREE-FORM tree the generic walker
  recurses into looking for ANY occurrence of that key; `service.env[].value`
  sits inside a small, independently-typed, non-free-form array that is
  never walked by that mechanism today (`build-substituted-resource.ts`'s
  `if (args.kind === "workflow")`/`if (args.kind === "agent")` branches are
  the ONLY two kinds it touches — `channel`/`connector`/`service` "pass
  through unchanged", line 6-8 of that file's own header comment). Reusing
  the key name `"value"` in `SUBSTITUTION_ALLOWLIST` would be UNSAFE: `value`
  is an extremely common property name that recurs elsewhere in a walked
  tree by coincidence (unlike `adapterId`/`catalog_skill_id`, which are
  purpose-specific) — a false-positive substitution risk the allowlist
  design was built to avoid (`substitution-allowlist.ts:1-9`'s own stated
  purpose). T02 instead adds a THIRD, narrowly-scoped kind branch to
  `build-substituted-resource.ts` (`if (args.kind === "service")`) that
  calls a small NEW dedicated function, reusing `substituteSymbolicRefs`'s
  proven fail-loud error kinds (`mismatched_symbolic_ref`/
  `unresolved_symbolic_ref`) but NOT its generic tree-walk entry point —
  mirrors how `provisioning-manifest-gaps-2.md` T03 added `knowledgeBases`'
  `substitute-kb-ingestion-config.ts` as a NEW tree root rather than forcing
  `ingestion_config` through the workflow/agent walker (same class of
  precedent: "reuse the proven PARTS, not the ENTRY POINT, when the
  container shape genuinely differs").
- `services/provisioning-service/src/modules/apply/lib/
  build-substituted-resource.ts:1-107` — `resolveRef(refType, name) =>
  args.resolvedIds.get(\`${targetKind}:${name}\`)`, called with the SAME
  `resolvedIds` map `apply-manifest.ts` accumulates for EVERY resource kind
  (not just workflow/agent — `apply-manifest.ts:326`'s
  `resolvedIds.set(...)` runs unconditionally after every writer call,
  regardless of kind). T02's `{ connectorRef }` (whole-connector) case reuses
  `resolveRef` AS-IS — since `RESOURCE_KIND_ORDER` already ranks `"connector"`
  (index 1) before `"service"` (index 5,
  `plan.interfaces.ts:12-28`), every connector in the SAME apply is already
  in `resolvedIds` by the time a service's `env[]` is substituted. NO new
  resolution infrastructure needed for this one shape.
- `services/provisioning-service/src/modules/apply/infrastructure/
  connectors-writer.ts:280-311` (the endpoint-reconcile block inside
  `ensure connector`) — `current.endpoints.some(e => e.method === ep.method
  && e.path === ep.path)` — confirms `(method, path)` is the ONLY
  addressing scheme endpoints have; T03's endpoint-ref resolver mirrors this
  exact comparison, does not invent a new one. `client.connectors.get(id)`
  (via the SDK, same pattern the deleted `02-hubspot-connector.ts` used for
  ITS OWN post-create smoke check) is the precedent T03's live re-fetch
  follows: the connector is guaranteed already created/updated in THIS
  apply by the time a `service` resource is reached (ordering above), so a
  single `GET /connectors/:id` inside the new resolver, reading
  `.endpoints[]` for the `(method, path)` match, is safe and mirrors an
  ALREADY-PROVEN pattern rather than inventing a new one (e.g. widening
  `CreateOrUpdateResult` to carry nested ids, considered and rejected as a
  bigger interface change for a single narrow need — see T03's own task
  text for the explicit alternative-considered note).
- `services/provisioning-service/src/modules/plan/lib/
  comparable-fields.ts:419-462` — `serviceComparable` (decision 6's
  citation) — verified NO CHANGE NEEDED.
- `services/registry-service/src/modules/services/knative-builder.ts:1-114`
  — `IBuildKnativeServiceBodyParams.envVars: Record<string,string>`,
  `envRecordToKnativeEnvList` (`Object.entries(envVars).map(([name,value])
  => ({name,value}))`) — the CURRENT plain-`{name,value}`-only Knative env
  builder Option B (decision 1) extends with a second variant.
- `services/registry-service/src/modules/services/services.service.ts:60-61,
  106` — `namespaceName(tenantId, environment) =>
  tenantKubernetesNamespaceName(tenantId, environment)` — Option B's
  namespace-match proof (paired with the `k8s-secrets-store.ts` citation
  above: BOTH resolve through the SAME `@yoizen/shared` helper, so they are
  namespace-identical by construction, not by coincidence that could drift).
- `manual-loops/provisioning-manifest-gaps-2.md:642-664` — T05's full
  two-round Progress entry: attempt 1 (Option-A-shaped, REJECTED by a
  reviewer), the HUMAN RULING (plain strings only), and the recorded
  FOLLOW-UP this SPEC is. Read this section in full before starting T04 —
  it is the single most load-bearing piece of prior art for decision 1.
- `manual-loops/declarative-provisioning.md:51-52` — decision 7, the
  FOUNDING k8s-native-secrets mandate Option B fulfills and Option A would
  contradict for a second time.
- The 12 shipped manifests (`ls integrations/*/*/manifest.yaml`, verified
  count 2026-07-24) — the regression set every task's Accept block
  re-validates + noop-reapplies; NONE currently declares any `services[].env`
  (verified `grep -L 'env:' integrations/*/*/manifest.yaml` — all 12 match,
  i.e. none has an `env:` key under `services:`), so this SPEC's schema
  widening is a pure add with zero risk of an existing manifest hitting a
  new code path unexpectedly.
- `manual-loops/crm-support-telegram.md` T01 mapping's "Manifest-engine gap"
  section (its own citations of `serviceEnvVarSchema`/`registry-services-
  writer.ts`/`substitution-allowlist.ts`) — the ORIGINAL discovery of this
  gap from the CONSUMER side; this SPEC is written from the PROVIDER
  (platform) side and should read as its formal closure.

## Constraints (apply to every task)

- Every new schema field/shape is OPTIONAL/additive — `value: z.string()`
  remains legal; the 12 shipped manifests (none declaring `env`) keep
  validating and noop-reapplying, regression-checked every task.
- No prune/delete semantics anywhere in this loop.
- Secret VALUES never appear in logs, events, API responses, plan output,
  the manifest file, or Postgres — for WHATEVER option decision 1 selects,
  this constraint governs every new code path the same way it governs every
  existing one. If decision 1 selects Option A, this constraint is
  IN TENSION with that choice (the value DOES end up in
  `registered_services.env_vars` Postgres JSONB and the live Knative spec) —
  that tension must be recorded explicitly in Progress, not silently
  accepted.
- Verbose logging on every new/extended writer/resolver/validator path;
  nothing fails silently — explicitly including the NEW endpoint-ref
  resolver's live re-fetch failure path (network/404/malformed response),
  which must fail loud with a typed error, never silently fall back to
  "leave the env var unresolved."
- Never weaken, skip, or delete existing tests — automatic reviewer
  rejection. This explicitly includes `comparable-fields.test.ts`'s existing
  `serviceComparable` assertions (T01 ADDS a ref-shaped-value noop test, does
  not touch the existing literal-value ones) and every existing
  `substitute-symbolic-refs.test.ts`/`build-substituted-resource.test.ts`
  scalar-allowlist assertion (T02/T03 add a NEW `service`-kind branch,
  untouched otherwise).
- All artifacts in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — shared package tests (schema lives here, every task)
cd packages/shared && bun test
# G2 — provisioning-service tests (every task)
cd services/provisioning-service && bun test
# G3 — provisioning-service typecheck (every task)
cd services/provisioning-service && bunx tsc -p tsconfig.json --noEmit
# G4 — registry-service tests (from T04 onward, ONLY if decision 1 selects
#      Option B — Option A never touches registry-service)
cd services/registry-service && bun test
# G5 — registry-service typecheck (from T04 onward, Option B only)
cd services/registry-service && bunx tsc -p tsconfig.json --noEmit
# G6 — sdk tests (every task, in case client method/type shapes move)
cd sdk && bun test
# G7 — REGRESSION: all 12 shipped manifests still validate and noop-reapply
#      (every task, run against the dev cluster)
for m in integrations/ai/ai-agent-playground/manifest.yaml \
         integrations/ai/ai-agent-triage/manifest.yaml \
         integrations/ai/ai-call-center-supervisor/manifest.yaml \
         integrations/ai/ai-knowledge-base-agent/manifest.yaml \
         integrations/ai/ai-skill-support-agent/manifest.yaml \
         integrations/ai/ai-system-variables/manifest.yaml \
         integrations/channels/http-fanout-telegram/manifest.yaml \
         integrations/channels/telegram-transform-reply/manifest.yaml \
         integrations/http/hosted-services-api/manifest.yaml \
         integrations/http/http-connectors/manifest.yaml \
         integrations/mcp/mcp-connections/manifest.yaml \
         integrations/mcp/mcp-repo-support-bot/manifest.yaml; do
  yoizen manifests validate -f "$m"
  yoizen manifests apply    -f "$m" --secrets-from-env
  yoizen manifests apply    -f "$m" --secrets-from-env   # second apply: 0 create / 0 update
done
# G8a — ITERATION (per attempt, source-mounted dev mode; provisioning-service
#       always, registry-service only for Option-B tasks)
./dev-mode.sh deps && ./dev-mode.sh provisioning-service on \
  [&& ./dev-mode.sh registry-service on]  && ./scripts/e2e-manifest-apply.sh
# G8b — COMMIT GATE (once per task, built image(s))
./dev-mode.sh provisioning-service off [&& ./dev-mode.sh registry-service off] \
  && ./rebuild-redeploy.sh provisioning-service dev \
  [&& ./rebuild-redeploy.sh registry-service dev] \
  && ./scripts/e2e-manifest-apply.sh
# G9 — LIVE VERIFICATION (T05 only): the exact crm use case — a
#      services[].env[] block with 2 secretRefs + 4 connector/endpoint refs
#      applies, resolves, and noops (see T05 for the full script)
```

Gate rules: identical spirit to `provisioning-manifest-gaps-2.md`/`-3.md`
(inherited) — G8a/G8b apply from T01 onward, every task in this loop touches
`provisioning-service`; G4/G5 (registry-service) apply from T04 onward ONLY
if decision 1 selects Option B (skip entirely for Option A — record which in
T04's Progress entry so this is never ambiguous later).

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` — check first
whether the KNOWN stage-4/5 internal race documented by the parent SPECs
still reproduces before assuming a NEW failure; if it still reproduces, skip
G8a and rely solely on G8b, same as all three parents.

E2E CLEANUP: `scripts/e2e-manifest-apply.sh` (extended per task) provisions
with account-scoped, e2e-prefixed names and tears down what it creates
(trap-guarded, idempotent) — this loop's tasks add a hosted-service +
service-scoped-secret fixture to that script's coverage (T01/T04), torn down
the same way.

Commits only happen with dev-mode OFF and the built image(s) live (G8b),
plus G1-G7 green.

---

## Task queue

### T01 — Schema + plan-time wiring (no apply-time resolution yet)

- Widen `serviceEnvVarSchema.value` from `z.string()` to a discriminated
  union: a bare string (unchanged) OR `{ secretRef: <binding> }` OR
  `{ connectorRef: <name> }` OR `{ connectorRef: <name>, endpointMethod:
  <method>, endpointPath: <path> }`. Rewrite the field's header comment
  (`manifest.schema.ts:539-562`) to record the FULL history (gaps-2 T05's
  reversal, this SPEC's reopening) rather than deleting it.
- Add `serviceEnvSecretRefs`/`serviceEnvConnectorRefs`-style extraction
  helpers to `validate-structural-rules.ts`, mirroring
  `connectorAuthSecretRefs`/`mcpServerAuthSecretRefs` exactly (decision 7's
  citation). Add the missing `manifest.spec.services.forEach(...)` block to
  `checkRefResolution`, validating: `secretRef` entries via the EXISTING
  `checkSecretRef` (scope `kind: "service", owner: <service name>`, reused
  verbatim) and `connectorRef` entries against `spec.connectors[].name`
  (mirrors the workflow `connectorRef` case already in the same function).
  The `endpointMethod`/`endpointPath` pair on an endpoint-ref shape is NOT
  structurally validated against the connector's actual endpoint list at
  this stage (no live data at validate time — mirrors how a workflow's
  `connectorRef` is validated for NAME existence only, never a live
  endpoint/field check) — document this explicitly as a documented
  limitation, not a silent gap.
- Regression test: prove `gatherSecretReferences`/`parse-owning-resource.ts`
  ALREADY surface a `services[N].env[M].secretRef` occurrence correctly with
  zero changes to either file (decision 7's citation) — if this assumption
  is WRONG, fix the actual gap found and record the correction here (not a
  silent deviation).
- Regression test: prove `serviceComparable`/`desired-fields-of-resource.ts`
  ALREADY noop correctly on a ref-shaped `value` with zero changes (decision
  6) — same "verify, don't assume" discipline.
- New unit tests: schema accepts all four `value` shapes; rejects a
  malformed ref object (e.g. `{ connectorRef, endpointMethod }` missing
  `endpointPath`); `checkRefResolution` catches an unresolved
  service-scoped `secretRef`/`connectorRef` at VALIDATE time (before any
  apply).

**Accept**
```
cd packages/shared && bun test -t "service.*env|serviceEnv"
cd services/provisioning-service && bun test -t "service.*env|serviceEnv"
# regression: 12 shipped manifests still validate + noop-reapply
```

### T02 — Apply-time `{ connectorRef }` (whole-connector) substitution

- Add a THIRD kind branch to `build-substituted-resource.ts`:
  `if (args.kind === "service")`, calling a small NEW pure function (e.g.
  `resolve-service-env-refs.ts`) that walks `service.env[]`, leaves literal
  string values untouched, and for a `{ connectorRef }`-shaped value (NOT
  yet the endpoint-ref shape — that is T03) resolves it via the SAME
  `resolveRef` closure `build-substituted-resource.ts` already threads to the
  workflow/agent branches (decision "reuse `resolvedIds`, not
  `SUBSTITUTION_ALLOWLIST`" — see Prior art for why this is a NEW branch, not
  a new allowlist entry).
- Fail-loud semantics mirror the scalar `SUBSTITUTION_ALLOWLIST` case exactly
  (reuse `mismatched_symbolic_ref`/`unresolved_symbolic_ref`, value-free
  messages): an unresolved connector name -> `unresolved_symbolic_ref`
  (`spec.services[N].env[M].value.connectorRef` in the path); do NOT invent a
  new error kind for this shape.
- Regression test: a synthetic service with `env: [{name: "X", value:
  {connectorRef: "demo-hubspot"}}]` resolves to the connector's real id at
  apply, in the SAME apply that also creates `demo-hubspot` (ordering proof,
  RESOURCE_KIND_ORDER `connector` < `service`); an unresolved connector name
  fails loud with the existing error kind.

**Accept**
```
cd services/provisioning-service && bun test -t "resolve-service-env|service.*connectorRef"
# regression: 12 shipped manifests still validate + noop-reapply
```

### T03 — Apply-time endpoint-ref substitution (NEW small mechanism)

- Extend the T02 resolver to also handle the `{ connectorRef, endpointMethod,
  endpointPath }` shape: after resolving the connector's own id (T02's
  logic), issue ONE `GET /connectors/:id` (via `client.connectors.get`, the
  SAME SDK call `02-hubspot-connector.ts`'s deleted smoke check used) and
  match `.endpoints[]` by `(method, path)` — mirrors
  `connectors-writer.ts:280-311`'s own endpoint-matching comparison exactly
  (decision 7's citation). Fail loud (NEW typed error, e.g.
  `endpoint_ref_not_found` — no existing error kind fits "connector resolved
  but the specific endpoint didn't", so this ONE new kind is justified and
  documented, unlike `SUBSTITUTION_ALLOWLIST`'s reused kinds) if no endpoint
  matches; the message names the connector, method, and path — never a
  value, consistent with every other fail-loud message in this lineage.
- Explicitly record the ALTERNATIVE considered and rejected: widening
  `CreateOrUpdateResult` (`platform-resource-writer.interface.ts`) so
  `connectors-writer.ts`'s `create`/`update` return nested endpoint ids
  alongside the connector's own `externalId`, avoiding the extra live GET.
  Rejected for T03's default because it changes a SHARED interface every
  writer implements for the benefit of exactly ONE new narrow consumer — if
  a reviewer prefers this shape instead, record the switch explicitly here,
  do not silently pick whichever is "easier" once coding starts.
- Regression test: a synthetic service env value `{connectorRef:
  "demo-hubspot", endpointMethod: "POST", endpointPath:
  "/crm/v3/objects/tickets"}` resolves to the matching endpoint's real id;
  wrong method/path combination on a resolvable connector fails loud with
  `endpoint_ref_not_found`; unresolvable connector name still fails loud with
  T02's `unresolved_symbolic_ref` (connector resolution happens first).

**Accept**
```
cd services/provisioning-service && bun test -t "endpointMethod|endpoint_ref_not_found"
# regression: 12 shipped manifests still validate + noop-reapply
```

### T04 — secretRef resolution (OPEN RULING GATE — human decides Option A vs B first)

- **Do not start implementation until decision 1 is resolved for this run.**
  Record the ruling (with date) at the top of this task's Progress entry
  before writing any code, mirroring `provisioning-manifest-gaps-2.md` T05's
  own two-round Progress entry format.
- **If Option A**: extend `registry-services-writer.ts`'s `buildEnvVars` to
  resolve `{ secretRef }` entries through `Iln` (mirrors
  `connectors-writer.ts`'s `resolveConnectorAuth`/`resolveField` call shape,
  scope `kind: "service", owner: <service name>`), keep sending the existing
  `envVars: Record<string,string>` body unchanged. Update the writer's own
  header comment (currently asserting "no secrets broker involvement
  whatsoever", `registry-services-writer.ts:10-20`) to reflect the new
  reality AND explicitly restate the Postgres/Knative-spec plaintext
  exposure this reopens (Constraints' tension note). No `registry-service`
  change; skip G4/G5.
- **If Option B**: (i) `registry-service`'s `services.dto.ts` gains a new env
  entry shape (`{name, value}` unchanged, PLUS `{name, secretKeyRef: {name,
  key}}`); (ii) `knative-builder.ts`'s `envRecordToKnativeEnvList` (or a
  sibling function) emits the k8s-native `valueFrom.secretKeyRef` variant for
  the new shape, `{name, value}` for the old one — same array, mixed
  entries legal; (iii) `provisioning-service`'s `registry-services-writer.ts`
  does NOT resolve to plaintext — it calls the broker/`ISecretsStore` for an
  EXISTENCE check only (fail loud, typed `secret_not_resolvable`, reused
  from the existing kind, if the named binding is missing) and sends
  `registry-service` the reference `{name: secretResourceName("service",
  service.name), key: secretRef}` — cite `secret-resource-name.ts:29-31`
  directly, do not re-derive the naming scheme inline. Both services' tests
  updated; G4/G5 apply.
- Either way: `buildEnvVars`'s existing "logs NAMES only, never values"
  discipline (`registry-services-writer.ts:22-24,142-146`) is preserved
  verbatim for every entry, literal or ref-resolved.
- Regression test (both options): a synthetic service with one literal env
  var and one `{ secretRef }` env var applies successfully; the second apply
  is a full noop (decision 6 — `envNames`-only comparable, unaffected by
  which option was chosen).

**Accept**
```
# Option A:
cd services/provisioning-service && bun test -t "service.*secretRef|buildEnvVars"
# Option B:
cd services/provisioning-service && bun test -t "service.*secretRef|secretKeyRef"
cd services/registry-service && bun test -t "secretKeyRef|env"
# regression: 12 shipped manifests still validate + noop-reapply
```

### T05 — Live verification: the exact crm-support-telegram T04 use case

- Build a throw-away hosted-service fixture (via `scripts/e2e-manifest-apply.sh`'s
  e2e-prefixed convention, torn down after) whose `env[]` carries the SAME
  SHAPE the `priority-scorer` service will need:
  `YOIZEN_EMAIL`/`YOIZEN_PASSWORD` as `{ secretRef }` (2 entries) and
  `HUBSPOT_CONNECTOR_ID` as `{ connectorRef }` plus
  `HUBSPOT_DEALS_ENDPOINT_ID`/`HUBSPOT_TICKETS_ENDPOINT_ID`/
  `HUBSPOT_CREATE_TICKET_ENDPOINT_ID` as `{ connectorRef, endpointMethod,
  endpointPath }` (4 entries) against a real connector with real endpoints
  in the SAME apply (reuse an existing canary connector or declare a small
  fixture one — either way, live, not mocked).
- Apply live: confirm every one of the 6 env entries resolves to the correct
  real value/id — for the 2 secretRefs, confirm INDIRECTLY (never log/print
  the resolved value): for Option A, confirm the value round-trips into the
  container's actual runtime env (e.g. a debug endpoint the fixture image
  exposes, or `kubectl exec ... -- env | grep -c` a COUNT only, never the
  value) matches the bound secret's known test value; for Option B, confirm
  the Knative spec's `env[].valueFrom.secretKeyRef` fields reference the
  RIGHT `{name, key}` pair (inspectable structurally, still no value
  exposure) AND that the pod's actual runtime env resolves correctly
  (k8s does the resolution, so this proves the WHOLE chain, not just the
  manifest layer).
- Second apply: full noop (0 create / 0 update) — proves decision 6 holds
  end-to-end, not just in a unit test.
- Update `manual-loops/crm-support-telegram.md`: replace the PAUSED note
  (added when this SPEC was authored) with a short note that gaps-4 shipped
  and T04 may resume, citing this SPEC's shipped state — human approves
  BEFORE the crm loop actually resumes (Human boundaries).

**Accept**
```
# G9 verbatim (above) — 6-entry env block applies, resolves (verified
# indirectly, no value ever printed), second apply is a full 0/0 noop
grep -n "PAUSED before T04" manual-loops/crm-support-telegram.md   # must be GONE after this task
```

---

- [x] T01 schema + plan-time wiring
- [x] T02 apply-time connectorRef (whole-connector) substitution
- [x] T03 apply-time endpoint-ref substitution
- [x] T04 secretRef resolution (Option B per human ruling 2026-07-24)
- [x] T05 live verification: exact crm-support-telegram T04 use case

## Out of scope (explicit)

- Any secret-carrying manifest field OTHER than `services[].env[].value` —
  every other `secretRef` consumer (channel, connector auth, mcpServer
  headers/auth) is already shipped and untouched here.
- Prune/delete semantics for any manifest section — still deferred.
- `systemVariables` secret-typed values (`provisioning-manifest-gaps.md` T04
  OPEN human ruling, still unresolved) — not revisited here.
- Generalizing the endpoint-ref mechanism (T03) to any OTHER nested,
  non-independently-named sub-resource beyond connector endpoints —
  speculative, not part of this SPEC's proven need.
- `registry-service` canary/traffic-splitting, route collision behavior, or
  any other `registry-service` module — Option B (decision 1) touches ONLY
  the Knative-body env construction, nothing else in that service.
- Actually resuming `manual-loops/crm-support-telegram.md` T04 — T05 only
  unblocks it (removes the PAUSED note); the crm loop's own human approval
  gate for resuming is separate (see that SPEC's Human boundaries).

## Human boundaries for this change

- **This entire SPEC needs its own human approval before T01 starts.**
- **Decision 1 (Option A vs B) is an OPEN ruling — human decides before T04
  starts**, not before T01 (T01-T03 are useful and testable independent of
  this ruling; only T04's actual writer/DTO change depends on which option
  wins). The ruling MUST explicitly weigh the History subsection (a human
  already reversed Option A once, on this exact field, for a proven security
  reason) — silently defaulting to Option A because it is the smaller diff
  is NOT an acceptable resolution path for this task.
- T05's live-verification env values are loaded by the human (a real
  `psec-service-*`-bound test secret, distinct from any production
  credential) — never fabricated in the repo.
- Any dependency that still cannot express its end-state after T01-T04 ship:
  stop and ask — do not invent a further gap kind or approximate.
- Removing the crm-support-telegram PAUSED note (T05) does not itself
  authorize resuming that loop's T04 — the crm loop's own human boundary
  ("human approves this SPEC before the first run" / per-task sign-off)
  still governs when T04 actually starts there.

## Progress

PRECONDITION verdict (2026-07-24): `validate-dev-mode.sh --with-e2e` fails at
stage 5 with a DIFFERENT symptom than the parents' recorded race (apply
processed only channel+agent, both workflows absent from plan AND apply — no
jq error), but the same class: `scripts/e2e/http-workflow.sh` standalone with
dev-mode off is fully green (all 14 stages), so the failure is internal to
the validator's post-canary reload window. Per this SPEC's own fallback:
G8a SKIPPED for this run, G8b (built image) is the cluster gate.

- [x] T01 schema + plan-time wiring — 2026-07-24. Four-shape
  `serviceEnvVarSchema.value` union + validate-time service-env ref checks;
  both "zero changes needed" assumptions (gatherSecretReferences,
  serviceComparable) held with regression proof. Deviations (both
  review-adjudicated): the gaps-2-era "rejects {secretRef}" schema test
  reversed (IS the ruled behavior change), and `buildEnvVars` now returns a
  Result failing loud (`unresolved_symbolic_ref`, never leaking values) on
  ref-shaped values until T02-T04 land resolution — failure branch fully
  test-covered after review round 1 objection. Gates: shared 324 /
  provisioning 417 / sdk 403 tests green, tsc clean, G7 12/12
  validate+apply+noop (http-connectors needs its two basic-auth binding env
  vars), G8b rebuild-redeploy + e2e-manifest-apply PASSED. Review: round 1
  1×REJECTED (missing failure-branch tests) → fixed → round 2 2×APPROVED.
- [x] T02 apply-time {connectorRef} substitution — 2026-07-24. New pure
  resolver `resolve-service-env-refs.ts` + third kind branch in
  `build-substituted-resource.ts` reusing the threaded resolveRef closure;
  endpoint-ref/secretRef shapes deliberately untouched (T03/T04) and still
  fail loud at the writer guard; registry-services-writer needed ZERO changes
  (substitution runs upstream in apply-manifest). Shape discrimination is
  schema-guaranteed (all four value shapes are .strict() — no bogus-key
  ambiguity can survive validate). Gates: provisioning 425 tests green, tsc
  clean, shared 324 / sdk 403 unaffected, G7 12/12 noop-reapply, G8b
  rebuild-redeploy + e2e-manifest-apply PASSED. Review: 2×APPROVED round 1.
- [x] T03 apply-time endpoint-ref substitution — 2026-07-24. Resolver extended
  for {connectorRef, endpointMethod, endpointPath}: connector id first (T02
  logic), then ONE tracedFetch GET /connectors/:id matching endpoints by
  (method,path) byte-identical to connectors-writer's
  reconcileConnectorEndpoints; new `endpoint_ref_not_found` kind (documented
  rationale); all fetch failure modes typed + loud incl. no-fetcher-wired;
  fetcher injected as closure, DI at apply.module.ts via
  CONNECTOR_ENDPOINT_FETCHER token (@Optional pattern like KB_RECONCILER).
  Note: SPEC's connectors-writer.ts:280-311 citation was stale (auth code) —
  the real match logic is reconcileConnectorEndpoints (~lines 70-84);
  reviewers verified equivalence. Deviations (adjudicated): T02 placeholder
  test replaced by real T03 behavior tests; tracedFetch used instead of the
  SPEC-prose client.connectors.get (provisioning-service never imports the
  SDK — codebase-consistent). Gates: provisioning 439 green, tsc clean,
  accept filter 8/8, G7 12/12, G8b rebuild + e2e PASSED. Review: 2×APPROVED
  round 1.
- [x] T04 secretKeyRef (Option B, ruled 2026-07-24) — 2026-07-24.
  registry-service: env DTO union {name,value}|{name,secretKeyRef:{name,key}}
  with strict custom validator, knative-builder emits valueFrom.secretKeyRef,
  mixed arrays legal, repositories store the reference opaquely.
  provisioning-service: registry-services-writer does broker EXISTENCE check
  only (.value never read — reviewer-verified), sends the reference built
  from secretResourceName("service", <name>); secret_not_resolvable reused;
  names-only logging preserved. Adjudicated reversal: T01's two
  secretRef-fail-loud writer tests replaced by existence-check tests
  (connector/endpoint guard tests intact). Gates: provisioning 444 /
  registry 124 / shared 324 / sdk 403 green, both tsc clean, accept filters
  9+12 pass, G7 12/12, G8b BOTH services rebuilt + e2e PASSED. Review:
  2×APPROVED round 1. Follow-up (non-blocking, from review):
  secret-value-resolver.interface.ts header comment still lists only
  channels/connectors writers as consumers — stale, fix opportunistically.
- [x] T05 live verification — 2026-07-24. Stage 9 added to
  scripts/e2e/manifest-apply.sh: LibraryManifest fixture (connector with 3
  real endpoints + hosted service with the exact 6-entry crm env shape) in
  ONE apply; structural ksvc proof (2 valueFrom.secretKeyRef pairs correct,
  no plaintext value fields, 4 real resolved ids matching the same-apply
  connector), pod-runtime resolution proven by counts only, second apply
  0/2 noop; trap-guarded teardown, run repeatedly green. Review round 1:
  1×REJECTED — the two secret values were fabricated inline, violating this
  SPEC's Human boundary; fixed to REQUIRED human-supplied
  E2E_T05_SECRET_EMAIL_VALUE/E2E_T05_SECRET_PASSWORD_VALUE (fail-loud, jq
  env-access so values never hit argv). Human supplied sample values
  (scripts/e2e/.env, gitignored) and authorized. Round 2: 2×APPROVED. G9
  re-run verbatim by the orchestrator: PASSED. crm SPEC's PAUSED note
  replaced with a non-authorizing gaps-4-shipped note. LOOP COMPLETE 5/5.
