# Telegram Ingest Flow

This document explains the workflow-based path for an inbound Telegram message.

It is split into two execution paths after the workflow starts:

1. **Path A**: call a simple hosted/internal service (`endpointCall` or `serviceCall`)
2. **Path B**: call an AI agent (`agentCall`) on YoizenClaw runtime

This document intentionally omits the channel-service auto-reply shortcut.

## Overview

```mermaid
flowchart LR
    tg[Telegram] --> gw[api-gateway]
    gw --> nats[(NATS INGRESS-<tenant>)]
    nats --> ch[channel-service]
    ch --> nats
    nats --> wftrigger[workflow-service-worker]
    wftrigger --> temporal[(Temporal)]
    temporal --> wfw[workflow-worker]
    wfw --> A[Path A: endpointCall/serviceCall]
    wfw --> B[Path B: agentCall]
    A --> ch
    B --> ch
    ch --> tga[Telegram Bot API]
```

## Common Inbound Steps (Both Paths)

```mermaid
sequenceDiagram
    autonumber
    participant TG as Telegram
    participant GW as api-gateway
    participant NATS as NATS INGRESS-tenant
    participant CH as channel-service
    participant WFT as workflow-service-worker
    participant TEMP as Temporal

    TG->>GW: POST /api/webhooks/telegram/:tenantId
    GW->>NATS: publish webhook_received event
    NATS->>CH: deliver webhook event
    CH->>CH: verify token + normalize payload
    CH->>NATS: publish telegram received event
    NATS->>WFT: deliver message_received trigger event
    WFT->>WFT: match trigger (type/pattern/account)
    WFT->>TEMP: start workflow execution
```

## Path A - Simple Hosted Service Call

Use this path when a workflow action needs an HTTP call (`endpointCall`/`serviceCall`) before replying on Telegram.

```mermaid
sequenceDiagram
    autonumber
    participant TEMP as Temporal
    participant WFW as workflow-worker
    participant CR as connector-runtime
    participant SVC as Hosted/Internal Service
    participant CH as channel-service
    participant TGA as Telegram Bot API

    TEMP->>WFW: run workflow actions
    WFW->>CR: execute endpointCall/serviceCall
    CR->>SVC: HTTP request
    SVC-->>CR: HTTP response
    CR-->>WFW: action result
    WFW->>CH: publish telegram send event
    CH->>TGA: sendMessage(reply)
    TGA-->>CH: 200 OK
```

## Path B - Agent Call (YoizenClaw)

Use this path when the workflow action is `agentCall`.

```mermaid
sequenceDiagram
    autonumber
    participant TEMP as Temporal
    participant WFW as workflow-worker
    participant YZG as yoizenclaw-runtime-gateway
    participant NATS as NATS INGRESS-tenant
    participant YZR as yoizenclaw-runtime
    participant CH as channel-service
    participant TGA as Telegram Bot API

    TEMP->>WFW: run workflow actions
    WFW->>YZG: execute agentCall (local activity)
    YZG->>NATS: publish execution_requested.v1
    NATS->>YZR: durable delivery
    YZR->>NATS: publish execution_started/execution_completed
    NATS->>YZG: lifecycle/result events
    YZG-->>WFW: results.agent.data.reply
    WFW->>CH: publish telegram send event
    CH->>TGA: sendMessage(reply)
    TGA-->>CH: 200 OK
```

## Key Subjects in This Flow

| Step | Subject Pattern | Stream |
|---|---|---|
| Webhook ingress published by gateway | `evt.<tenant>.api-gateway.messaging.telegram.webhook.webhook_received.v1` | `INGRESS-<tenant>` |
| Normalized inbound message published by channel-service | `evt.<tenant>.channel-service.messaging.telegram.telegram.received.v1` | `INGRESS-<tenant>` |
| Outbound send command published by workflow | `evt.<tenant>.channel-service.messaging.telegram.telegram.send.v1` | `INGRESS-<tenant>` |
| Agent execution request published by runtime-gateway | `evt.<tenant>.yoizenclaw-runtime-gateway.automation.yoizenclaw.internal.execution_requested.v1` | `INGRESS-<tenant>` |

## Notes

- After the message is on NATS, this trigger-based path does not go through `workflow-service-api`; `workflow-service-worker` starts Temporal directly.
- `agentCall` path uses `yoizenclaw-runtime-gateway` and `yoizenclaw-runtime` over JetStream events.
