# Reset, redeploy and re-run the e2e

Class: prescriptive
Summary: Step-by-step runbook to wipe the tenant's e2e artifacts, redeploy the services changed by the e2e-tests-channel work, and re-run the suite from a genuinely cold start.

Written for the dev cluster in **dev-mode** (`./dev-mode.sh`), where services
run `bun --watch` off the hostPath-mounted repo. In that mode "redeploy" means
*restart the pod* — there is no image to rebuild. If a service is NOT in
dev-mode, use `./rebuild-redeploy.sh` for it instead.

Everything below assumes `./port-forward.sh` is running in its own terminal.

---

## Why each step exists

Two of these steps are not optional, and both were learned the hard way:

- **The DB constraint.** `channel_accounts` has a CHECK enumerating the
  allowed channels. Adding `e2e-tests` to it only takes effect for a tenant
  when `ensureSchema` runs again, which happens on a fresh connection pool —
  i.e. after channel-service restarts. Skipping step 3 leaves the tenant
  rejecting the sink account with a PostgresError.
- **Order.** provisioning-service validates the channel type before
  channel-service ever sees it, so both must be restarted before the suite
  runs, not after it fails.

---

## 1. Wipe the tenant's e2e artifacts

Deletes every resource the suite provisions, so the next run is a true cold
start. Safe to re-run; each delete is best-effort.

```bash
cd /Users/chris/sources/yoizen/platform-cluster

T=$(curl -s -X POST http://api-gateway.platform-services-dev.dev.local/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"yclawd@demo.io","password":"admin123","tenant_id":"acme"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
H=(-H "x-yoizen-tenant: acme" -H "Authorization: Bearer $T")
B=http://api-gateway.platform-services-dev.dev.local

# workflows (all three per run: log, agentflow, composite)
for id in $(curl -s "$B/api/workflows" "${H[@]}" \
  | python3 -c "import sys,json;[print(w['id']) for w in json.load(sys.stdin) if w['name'].startswith('e2e-')]"); do
  curl -s -o /dev/null -X DELETE "$B/api/workflows/$id" "${H[@]}"
done

# channel accounts — BOTH channels: the http ingress and the e2e-tests sink
for ch in http e2e-tests; do
  for id in $(curl -s "$B/api/channels/accounts?channel=$ch" "${H[@]}" \
    | python3 -c "import sys,json;[print(a['id']) for a in json.load(sys.stdin)]"); do
    curl -s -o /dev/null -X DELETE "$B/api/channels/accounts/$id" "${H[@]}"
  done
done

# echo agent
for id in $(curl -s "$B/api/admin/agents" "${H[@]}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);[print(a['id']) for a in (d if isinstance(d,list) else d.get('items',[])) if 'e2e' in a.get('name','')]"); do
  curl -s -o /dev/null -X DELETE "$B/api/admin/agents/$id" "${H[@]}"
done

# the two standing fixtures — deleting these is what makes the run COLD
CID=$(curl -s "$B/api/connectors?name=pokeapi" "${H[@]}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
[ -n "$CID" ] && curl -s -o /dev/null -X DELETE "$B/api/connectors/$CID" "${H[@]}"

SID=$(curl -s "$B/api/registry/services?name=sample-echo" "${H[@]}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
[ -n "$SID" ] && curl -s -o /dev/null -X DELETE "$B/api/registry/services/$SID" "${H[@]}"
```

**Expect:** all four counts zero, and the tenant namespace empty.

```bash
for r in connectors registry/services workflows; do
  printf '%-18s %s\n' "$r" "$(curl -s "$B/api/$r" "${H[@]}" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"
done
kubectl get ksvc -n acme-dev-ns          # -> No resources found
```

---

## 2. Restart the changed services

Four services changed, plus `packages/shared` — which every one of them
imports, so its consumers all need the restart regardless of whether their own
source moved.

```bash
# Knative services: delete the pod, the ksvc recreates it
for svc in channel-service-api api-gateway provisioning-service workflow-service-api; do
  kubectl delete pod -n platform-services-dev -l serving.knative.dev/service=$svc
done

# plain Deployments
for dep in channel-service-worker workflow-service-worker workflow-worker; do
  kubectl rollout restart deploy/$dep -n platform-services-dev
  kubectl rollout status  deploy/$dep -n platform-services-dev --timeout=150s
done
```

> **Deleting the api-gateway pod kills the port-forward.** It targets that pod
> by name, so it dies with it. Restart `./port-forward.sh` before continuing —
> the suite fails at stage 1 with curl exit 7 otherwise.

**Expect** every pod `Running` and ready:

```bash
kubectl get pods -n platform-services-dev | rg "channel-service|api-gateway|provisioning|workflow"
```

---

## 3. Confirm the schema migration landed

The CHECK constraint is re-applied by `ensureSchema` on the first connection
after the restart. Verify rather than assume — this is the step whose absence
produces a confusing PostgresError three minutes into the run.

```bash
kubectl exec -n support-services-dev postgres-shared-1 -- \
  psql -U postgres -d tenant_acme -Atc \
  "select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'channel_accounts_channel_check';"
```

**Expect** `e2e-tests` in the list:

```
CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'instagram'::text,
       'telegram'::text, 'http'::text, 'e2e-tests'::text])))
```

If it is missing, channel-service has not re-run `ensureSchema` for this
tenant yet — restart `channel-service-api` again and re-check.

---

## 4. Run the suite

```bash
E2E_API_URL=http://localhost:8080 ./scripts/e2e/http-workflow.sh
```

**Expect exit 0** and, specifically, these five lines — they are the ones that
cover the work in these commits:

```
Prerequisites manifest applied: appliedCount=2 noopCount=0   <- cold start: both fixtures created
ksvc/sample-echo-acme is Ready                               <- the rollout gate
Confirmed: conditional took branch 'matches-nonce' ...       <- conditional, incl. ordering
Confirmed: sent.v1 payload carries providerMessageId=e2e-... <- egress via the sink channel
Confirmed: both fan-out branches ran ...                     <- branch
Confirmed: nested serviceBusCall completed ok ...            <- serviceBusCall + fallback fix
```

Run it a second time without wiping. **Expect exit 0 again**, and the first
line to become `appliedCount=0 noopCount=2` — that is the idempotency proof:
the fixtures are reconciled, not duplicated.

---

## 5. Prove the fallback fix actually ran

`serviceBusCall` reporting `ok` is necessary but not sufficient — it would
also read `ok` if the publish had gone to a streamed subject. The log line is
what proves the core-NATS fallback path executed:

```bash
kubectl logs -n platform-services-dev deploy/workflow-worker --tail=4000 \
  | rg "falling back to core NATS"
```

**Expect:**

```
serviceBusCall falling back to core NATS: no stream bound to
'e2e.bus-probe.<nonce>' (no server-side dedup on this path)
```

---

## If something fails

| Symptom | Cause |
|---|---|
| curl exit 7 / HTTP 000 at stage 1 | port-forward died with the api-gateway pod (step 2) |
| `unsupported type 'e2e-tests'` | provisioning-service not restarted |
| `violates check constraint channel_accounts_channel_check` | step 3 — schema not re-applied |
| serviceCall FAILED, breaker CIRCUIT_OPEN | sample-echo cold; the ksvc-Ready gate should prevent it — check the pod exists in `acme-dev-ns` |
| stage 1b 404 on the adapter | stale `E2E_ENDPOINT_ADAPTER_ID` pinned in `scripts/e2e/.env`; unset it and let the suite resolve by name |
