# CHECKPOINT — compact state for iterating

Single resume point. Summarizes everything done and how to run the test from scratch.

## Git state (verified)

- **Committed** (`6292520` + earlier): ingress fix (`channel-service` inherits the causal chain) + traceability persistence in audit (`events`, `channel_events`, `gateway_audit_events`) + propagation to the gateway (Option B) + removal of `packages/sdk` (TS).
- **Uncommitted** (only this): `.mcp.json`, `.cbmignore` (tooling), `.sdd/changes/` (SDD artifacts), `cowork/` (these docs).

## Traceability: done vs pending

| Item | State |
|---|---|
| Persist `correlation_id`/`causation_id`/`depth` in audit + endpoint `/audit/events/chain/:id` | ✅ shipped |
| Persist those IDs in `channel_events` + `gateway_audit_events` (Option B) | ✅ shipped |
| Root ingress fix (canonical inherits the chain from the webhook) | ✅ shipped + committed |
| `traceability-channel-chain-endpoint` (query/chain over `channel_events`) | ✅ shipped (endpoint `GET /audit/channel-events/chain/:correlationId`) |
| Minor: depth-tracker `>=`/`>`, D9 traceid | ⏳ pending (optional) |

## Active config

- **codebase-memory-mcp** connected to Claude Code (`.mcp.json`); graph indexed; maintenance via `scripts/cbm-reindex.sh` + git hooks. Setup details in `codebase-memory-mcp-setup.md`.
- **Claude Code SDD**: subagents `.claude/agents/sdd-*`, commands `/sdd:*`, lint+test hooks, **cheap (Haiku)** profile active (`node scripts/sdd-profile.mjs show`).
- Full docs in `cowork/` (see `INDEX.md`); dev handoff in `CHANGES-for-dev.md`.

## Test from scratch (runbook)

> You're in PoC → cutover, no backfill: you start with clean data.
> Validated on OrbStack (macOS) and minikube (Linux).

```bash
# Option A — OrbStack (macOS)
./scripts/orbstack/startup.sh

# Option B — minikube (Linux / CI)
./scripts/minikube/startup.sh
# The script uses BUILD_PARALLELISM=2 and brings up a Kourier port-forward to localhost:8080
# READY_WAIT=300 by default (slow boxes can raise it).
```

Internally the orchestrator does: sudo up-front → precheck → rebuild → bootstrap → readiness gate (poll) → (minikube: Kourier port-forward) → setup-tenant → e2e.

To run the steps separately (debugging, or when the cluster is already up):

```bash
# Manual rebuild
./rebuild-changed.sh                 # or bootstrap-orbstack-osx.sh / bootstrap-minikube-linux.sh

# Tenant
./setup-tenant.sh                    # tenant acme + admin

# E2E
E2E_API_URL=http://localhost:8080 ./scripts/e2e-http-workflow.sh

# Verify traceability: take the correlation_id and hit:
#   GET /audit/events/chain/<correlation_id>
#   GET /audit/channel-events/chain/<correlation_id>
```

## Suggested next step

All traceability work is shipped. The only pending item is the optional minor `traceability-depth-and-traceid` (`>=`/`>` adjustment in depth-tracker + D9 traceid). After that: commit the tooling + `.sdd/` artifacts if not already committed.

## How we iterate here

I don't run your cluster (I have no kubectl). You run the commands and **paste me the outputs** (logs, `/audit/...chain` responses, errors) and we adjust from Cowork. To save cost: Claude Code on Haiku to implement; Cowork (here) for diagnosis/decisions.
