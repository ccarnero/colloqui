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

## Samples

```bash
# 6) HTTP connectors
# No .env required.
cd integrations/http/http-connectors
./setup.sh
cd ../../..

# 7) Telegram account + reply workflow
cat > integrations/channels/telegram-transform-reply/.env <<'ENV'
TELEGRAM_BOT_TOKEN=<bot-token-from-botfather>
# Optional, only for real Telegram webhook inbound:
# TG_PUBLIC_URL=https://<public-https-url>
# Optional, only for synthetic inbound test:
# SIMULATE_INBOUND=1
# TELEGRAM_TEST_CHAT_ID=<numeric-chat-id>
ENV
cd integrations/channels/telegram-transform-reply
./setup.sh
cd ../../..

# 8) HTTP fanout -> connectors -> Telegram
cat > integrations/channels/http-fanout-telegram/.env <<'ENV'
TELEGRAM_CHAT_ID=<numeric-chat-id>
# Optional: lets run.sh also provision/reuse the Telegram account.
# TELEGRAM_BOT_TOKEN=<bot-token-from-botfather>
ENV
cd integrations/channels/http-fanout-telegram
./setup.sh
./run.sh
cd ../../..

# 9) AI agent playground
cat > integrations/ai/ai-agent-playground/.env <<'ENV'
AI_AGENT_PROVIDER=openai
AI_AGENT_MODEL=gpt-4o-mini
AI_CREDENTIAL_MODE=connector
AI_LLM_CONNECTOR_NAME=sample-openai-llm
OPENAI_API_KEY=<real-openai-key>
OPENAI_BASE_URL=https://api.openai.com/v1
RECREATE=0
POLL_TIMEOUT_S=90
ENV
cd integrations/ai/ai-agent-playground
./setup.sh
cd ../../..

# 10) AI knowledge base agent
cat > integrations/ai/ai-knowledge-base-agent/.env <<'ENV'
AI_AGENT_PROVIDER=openai
AI_AGENT_MODEL=gpt-4o-mini
AI_CREDENTIAL_MODE=connector
AI_LLM_CONNECTOR_NAME=sample-openai-llm
OPENAI_API_KEY=<real-openai-key>
OPENAI_BASE_URL=https://api.openai.com/v1
KB_EMBEDDING_MODEL=text-embedding-3-small
KB_NAME=ai-sample-support-kb
AI_AGENT_NAME=ai-sample-kb-agent
AI_AGENT_MESSAGE=According to the support FAQ, what is the refund policy? Include the verification phrase if you see one.
RECREATE=0
POLL_TIMEOUT_S=120
DOC_TIMEOUT_S=120
ENV
cd integrations/ai/ai-knowledge-base-agent
./setup.sh
cd ../../..

# 11) Hosted services API sample
cat > integrations/http/hosted-services-api/.env <<'ENV'
HOSTED_SERVICE_NAME=sample-echo
HOSTED_ROUTE_PREFIX=/samples/hosted-echo
HOSTED_SERVICE_IMAGE=ealen/echo-server:latest
HOSTED_SERVICE_PORT=8080
RECREATE=0
ENV
cd integrations/http/hosted-services-api
./setup.sh
./run.sh
cd ../../..

# 12) HTTP bridge sample - long-running, keep terminal open
# No .env required.
cd sdk/examples/reference-pattern
./run.sh
```

## Gotcha

For the KB AI sample, connector mode covers ingestion, but runtime KB retrieval may still need `OPENAI_API_KEY` on `agent-ai-service`.
