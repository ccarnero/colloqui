# Bootstrap from scratch and run all samples

## Platform

```bash
# 1) Bootstrap full stack
./bootstrap-orbstack-osx.sh --smoke

# 2) Keep gateway reachable - separate terminal, keep running
./port-forward.sh

# 3) Provision demo tenant/user
./setup-tenant.sh

# 4) Verify platform readiness
./scripts/smoke-test.sh

# 5) Optional core e2e
E2E_API_URL=http://localhost:8080 ./scripts/e2e-http-workflow.sh
```

For Linux/minikube, replace step 1 with:

```bash
./bootstrap-minikube-linux.sh --smoke
```

Samples are organized into three tiers, each with one reason to exist:
`sdk/examples/` (SDK API-surface examples), `integrations/` (end-to-end
platform-feature references, grouped `channels/`/`ai/`/`http/`/`mcp/`), and
`demos/` (commercial showcases, untouched here). See
[`integrations/README.md`](./integrations/README.md) for the taxonomy and the
declarative provisioning convention. **All 12 `integrations/` samples are now
declarative**: each ships a `manifest.yaml` (`IntegrationManifest` or
`LibraryManifest`) applied via the `yoizen` CLI (`manifests validate|plan|
apply -f manifest.yaml --secrets-from-env`) — none run a `setup.sh`/`setup.ts`
anymore.

```bash
# 6) HTTP connectors (LibraryManifest — connector catalog only, no channel/process)
cd sdk && bun link && cd ..   # one-time; or prefix each call with `cd sdk && bun run bin/yoizen.ts`
yoizen manifests validate -f integrations/http/http-connectors/manifest.yaml
yoizen manifests plan     -f integrations/http/http-connectors/manifest.yaml
env 'httpbin-basic-auth-username=user' 'httpbin-basic-auth-password=passwd' \
  yoizen manifests apply -f integrations/http/http-connectors/manifest.yaml --secrets-from-env

# 7) Telegram account + reply workflow
yoizen manifests validate -f integrations/channels/telegram-transform-reply/manifest.yaml
yoizen manifests plan     -f integrations/channels/telegram-transform-reply/manifest.yaml
env 'telegram-bot-token=<bot-token-from-botfather>' \
  yoizen manifests apply -f integrations/channels/telegram-transform-reply/manifest.yaml --secrets-from-env
# Optional: register the real Telegram webhook, or drive a synthetic inbound —
# see integrations/channels/telegram-transform-reply/README.md "Run / exercise".

# 8) HTTP fanout -> connectors -> Telegram (depends on steps 6 and 7)
yoizen manifests validate -f integrations/channels/http-fanout-telegram/manifest.yaml
yoizen manifests plan     -f integrations/channels/http-fanout-telegram/manifest.yaml
yoizen manifests apply    -f integrations/channels/http-fanout-telegram/manifest.yaml --secrets-from-env
# Edit spec.systemVariables[0].value in manifest.yaml to your real Telegram chat id, then re-apply
# (see its README.md "Configure"). Exercise it (read-only preflight + POST):
cd integrations/channels/http-fanout-telegram && ./run.sh && cd ../../..

# 9) AI agent playground (LibraryManifest — connector + agent, no channel)
yoizen manifests validate -f integrations/ai/ai-agent-playground/manifest.yaml
yoizen manifests plan     -f integrations/ai/ai-agent-playground/manifest.yaml
env "ai-agent-playground-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f integrations/ai/ai-agent-playground/manifest.yaml --secrets-from-env
cd integrations/ai/ai-agent-playground && ./run.sh && cd ../../..

# 10) AI knowledge base agent (LibraryManifest — connector + KB + agent, no channel)
yoizen manifests validate -f integrations/ai/ai-knowledge-base-agent/manifest.yaml
yoizen manifests plan     -f integrations/ai/ai-knowledge-base-agent/manifest.yaml
env "ai-knowledge-base-agent-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f integrations/ai/ai-knowledge-base-agent/manifest.yaml --secrets-from-env
cd integrations/ai/ai-knowledge-base-agent && ./run.sh && cd ../../..

# 11) Hosted services API sample (depends on step 7 for its Telegram notify step)
yoizen manifests validate -f integrations/http/hosted-services-api/manifest.yaml
yoizen manifests plan     -f integrations/http/hosted-services-api/manifest.yaml
yoizen manifests apply    -f integrations/http/hosted-services-api/manifest.yaml --secrets-from-env
# Edit spec.systemVariables[0].value in manifest.yaml to your real Telegram chat id, then re-apply
# (see its README.md "Configure").
cd integrations/http/hosted-services-api && ./run.sh && cd ../../..

# 12) HTTP bridge sample - long-running, keep terminal open
# No .env required.
cd sdk/examples/reference-pattern
./run.sh
```

The remaining six samples (`ai-agent-triage`, `ai-call-center-supervisor`,
`ai-skill-support-agent`, `ai-system-variables`, `mcp-connections`,
`mcp-repo-support-bot`) follow the identical `validate` -> `plan` -> `apply
--secrets-from-env` -> `run.sh` pattern — see
[`integrations/README.md`](./integrations/README.md) and each sample's own
README for its specific secret bindings, cross-sample dependencies, and
`.env` overrides.

## Gotcha

For the KB AI sample, connector mode covers ingestion, but runtime KB retrieval may still need `OPENAI_API_KEY` on `agent-ai-service`.
