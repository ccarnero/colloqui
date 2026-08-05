# Instagram Messaging

Class: descriptive
Summary: Instagram messaging end to end — the Meta API surface, the channel-service implementation, and (Part 3) the WhatsApp/Instagram code-reuse classification merged in from meta-provider-pattern.md.

> **Status:** implemented
> **See also:** [channel-service.md](./channel-service.md) — full ingress/egress pipeline. The WhatsApp/Instagram reuse classification (formerly `meta-provider-pattern.md`) is Part 3 of this file.

---

## Part 1 — Instagram Messaging API

### What it is

The Instagram Messaging API lets professional Instagram accounts (Business or Creator) receive and send direct messages (DMs) via API. It runs on the Meta Platform infrastructure — the same as WhatsApp Cloud API.

**Send base URL:** `https://graph.instagram.com/v21.0`

**Cost:** Free — no per-message charges (unlike WhatsApp, which bills per business-initiated conversation).

### Requirements

| Requirement | Detail |
|-------------|--------|
| Meta App | The same app used for WhatsApp, or a new one |
| Facebook Page | Linked to the Instagram Professional account |
| Instagram Professional Account | Business or Creator (not personal) |
| Permissions | `instagram_manage_messages`, `pages_manage_metadata` |
| Webhook subscription | Object `instagram`, field: `messages` |
| Access token | Instagram User Access Token (OAuth) |

### Key differences from WhatsApp

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| **User identifier** | Phone number or BSUID | IGSID (Instagram-Scoped ID) |
| **Send endpoint** | `graph.facebook.com/{phone_id}/messages` | `graph.instagram.com/{ig_id}/messages` |
| **Webhook `object`** | `"whatsapp_business_account"` | `"instagram"` |
| **Webhook structure** | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| **Signature header** | `x-hub-signature-256` (HMAC-SHA256) | `x-hub-signature-256` (HMAC-SHA256, identical) |
| **Templates** | Yes (pre-approved by Meta) | No — only within 24-hour window |
| **Reply window** | 24 hours | 24 hours (7 days with `human_agent` tag) |
| **Echo messages** | No | Yes — `message.is_echo: true` when the business sends |
| **Status updates** | Yes — via `statuses[]` in webhook | No — no delivery receipts |
| **Max text** | 4096 bytes | 1000 bytes |

### Webhook payload structure

#### Inbound text message

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "<IG_USER_ID>",
      "time": 1458692751478,
      "messaging": [
        {
          "sender": { "id": "<IGSID>" },
          "recipient": { "id": "<IG_USER_ID>" },
          "timestamp": 1458692752478,
          "message": {
            "mid": "<MESSAGE_ID>",
            "text": "Hello!"
          }
        }
      ]
    }
  ]
}
```

#### Message with image attachment

```json
{
  "message": {
    "mid": "<MESSAGE_ID>",
    "attachments": [
      {
        "type": "image",
        "payload": { "url": "<CDN_URL>" }
      }
    ]
  }
}
```

#### Echo message (sent by the business)

```json
{
  "message": {
    "mid": "<MESSAGE_ID>",
    "text": "Thank you for your message",
    "is_echo": true
  }
}
```

Echo messages are filtered in `instagram.provider.ts` (`isEchoMessage`) to prevent processing loops. If `message.is_echo === true`, the message is discarded.

### Send API

#### Send text

```
POST https://graph.instagram.com/v21.0/<IG_ID>/messages
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "recipient": { "id": "<IGSID>" },
  "message": { "text": "Hello! Thank you for your message." }
}
```

#### Send image

```
POST https://graph.instagram.com/v21.0/<IG_ID>/messages
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "recipient": { "id": "<IGSID>" },
  "message": {
    "attachment": {
      "type": "image",
      "payload": { "url": "<PUBLIC_IMAGE_URL>" }
    }
  }
}
```

The image must be a publicly accessible URL.

### Messaging window

| Window | Duration | Notes |
|--------|----------|-------|
| Standard | 24 hours from last user message | Default |
| Extended | 7 days | Requires `human_agent` tag and additional permission |
| Outside window | — | Cannot send — no templates available (unlike WhatsApp) |

### Webhook verification

Uses the same HMAC-SHA256 mechanism as WhatsApp: header `x-hub-signature-256` with the signature computed using the Meta App Secret. The verification code is in `meta-base.ts` and is shared by both providers.

---

## Part 2 — Implementation in channel-service

### Implementation files

| File | Responsibility |
|------|---------------|
| `services/channel-service/src/providers/meta/instagram/instagram.provider.ts` | Main provider: `parseWebhook`, `sendMessage`, `buildSendPayload` |
| `services/channel-service/src/providers/meta/meta-channel-provider.base.ts` | Shared Meta base: `signatureHeader`, `verifySignature` |
| `services/channel-service/src/providers/meta/meta-base.ts` | `verifyWebhookSignature` (HMAC-SHA256), `sendMetaMessage` |
| `services/channel-service/src/providers/meta/provider-registry.ts` | `ProviderRegistry` — the Meta-family map (`whatsapp`, `instagram`) |
| `services/channel-service/src/providers/channel-router.ts` | `ChannelRouter` — aggregates `ProviderRegistry` plus the Telegram/HTTP providers into one `Map<Channel, IChannelProvider>` |
| `services/channel-service/src/modules/webhooks/webhook-ingress.service.ts` | account resolution (`resolveAccount`, `extractInstagramBusinessIdHint`) |

### `parseWebhook`

```typescript
// instagram.provider.ts
parseWebhook(rawBody: Record<string, unknown>): InboundMessage[] {
  const messages: InboundMessage[] = [];
  const entry = rawBody.entry as Array<Record<string, unknown>>;
  for (const e of entry) {
    const messaging = e.messaging as Array<Record<string, unknown>>;
    for (const event of messaging) {
      if (this.isEchoMessage(event)) continue;  // echo filter
      const parsed = this.parseInstagramMessage(event);
      if (parsed) messages.push(parsed);
    }
  }
  return messages;
}
```

### Account lookup

The primary account-resolution mechanism is HMAC signature verification against every active account for the tenant (`WebhookIngressService.resolveAccount`). When more than one account passes verification, the `ig_user_id` hint — extracted from `entry[].messaging[].recipient.id` — disambiguates:

```typescript
// webhook-ingress.service.ts
function extractInstagramBusinessIdHint(body) {
  for (const ent of body.entry) {
    for (const m of ent.messaging) {
      const mid = m?.recipient?.id;
      if (typeof mid === "string") return mid;
    }
  }
}
```

Among the accounts whose `appSecret` verified the signature, `channel-service` picks the one whose `igUserId === recipient.id` for the tenant.

### Signature verification

Instagram uses the same header and mechanism as WhatsApp:

```
Header: x-hub-signature-256
Value:  sha256=<hmac-sha256(rawBody, appSecret)>
```

The verification code is shared with WhatsApp via `meta-channel-provider.base.ts`:

```typescript
readonly signatureHeader = "x-hub-signature-256";

verifySignature(rawBody: Uint8Array, signature: string, secret: string): boolean {
  return verifyWebhookSignature(Buffer.from(rawBody), signature, secret);
}
```

The comparison uses `timingSafeEqual` to prevent timing attacks.

### `sendMessage`

**Text:**

```typescript
// instagram.provider.ts
async sendMessage(account: ChannelAccount, message: OutboundMessage) {
  const url = `https://graph.instagram.com/v21.0/${account.igUserId}/messages`;
  const body = { recipient: { id: message.to }, message: { text: message.text } };
  return sendMetaMessage({ url, token: account.accessToken, body, ... });
}
```

**Image:**

```typescript
const body = {
  recipient: { id: message.to },
  message: {
    attachment: { type: "image", payload: { url: message.mediaUrl } }
  }
};
```

`account.igUserId` is the IG Professional Account ID — the same value Meta puts in
`entry[].id` and in `messaging[].recipient.id`. Only `recipient.id` is read by the
code (`extractInstagramBusinessIdHint`); `entry[].id` is never inspected.

### Parse differences vs WhatsApp

`parseWebhook` on either provider extracts messages only — no account identifier, no
status/receipt handling. The first two rows below therefore name the *resolution*
site (`webhook-ingress.service.ts`), not the parser.

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| Account hint (tie-break only) | `extractMetaPhoneNumberId` → `entry[0].changes[0].value.metadata.phone_number_id` | `extractInstagramBusinessIdHint` → `entry[].messaging[].recipient.id` |
| Status updates | **not parsed** — `WhatsAppProvider.parseWebhook` reads `value.messages` and ignores `value.statuses[]` | not sent by the channel |
| Sender identifier | `messages[].from` (phone/BSUID), normalized by `normalizeRecipient` | `messaging[].sender.id` (IGSID), verbatim |
| Message path | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| Echo filter | Not needed | `message.is_echo === true` → skip |

### `ChannelAccount` fields for Instagram

The Instagram-relevant subset of the `ChannelAccount` interface
(`packages/shared/src/channel.interfaces.ts`) — `igUserId`, `appSecret`,
`verifyToken` and `appId` are all optional on the type, and `id`, `tenantId`,
`name`, `externalId`, `isActive`, `createdAt`, `updatedAt` are required on every
account regardless of channel:

```typescript
{
  channel: "instagram",
  provider: "meta",
  externalId: "...",          // instance-addressed webhook URL segment
  igUserId: "17841400...",    // IG Professional Account ID
  accessToken: "...",         // Instagram User Access Token
  appSecret: "...",           // used to verify webhook signature
  verifyToken: "...",         // used for GET verification challenge
}
```

### Emitted NATS subject

```
evt.<tenant>.channel-service.messaging.instagram.meta.received.v1
```

The `channel` token in the subject lets downstream consumers filter by channel without inspecting the payload.

---

## Part 3 — Meta provider reuse (WhatsApp ↔ Instagram)

> Merged in from the former `DOCS/channels/meta-provider-pattern.md`
> (docs-truth-audit T10, ruling D7). WhatsApp and Instagram both sit on the Meta
> Platform, so most of the `channel-service` implementation is shared. Each
> component below is classified **identical** (reused unchanged), **adapted**
> (same logic, different structure) or **new** (no WhatsApp equivalent).

### Identical — reused without changes

- **Webhook signature verification.** Both channels use `x-hub-signature-256`
  (HMAC-SHA256 over the raw body with the App Secret). `verifyWebhookSignature`
  lives in `meta-base.ts`; `MetaChannelProviderBase` declares `signatureHeader`
  and delegates `verifySignature()` to it, so neither concrete provider
  implements verification itself. Quoted in full under "Signature verification"
  above.
- **Outbound HTTP send.** `sendMetaMessage()` in `meta-base.ts` performs every
  Graph API POST for both channels: `Authorization: Bearer <account.accessToken>`,
  `Content-Type: application/json`, a 10 s `AbortSignal.timeout`, and uniform
  error/`SendMessageResult` shaping. Each provider supplies only the URL, the
  JSON body and a `parseSuccessBody` callback that pulls the provider message id
  out of the channel-specific response.
- **OAuth token handling.** `exchangeForLongLivedToken()` in `meta-token.ts`
  trades a short-lived token for a long-lived one via the `fb_exchange_token`
  grant on `graph.facebook.com/v22.0` (one version ahead of the send endpoints'
  `v21.0`). `AccountsService` calls it and rejects the request unless
  `account.provider === "meta"`, so the same path serves both channels. Refresh
  is an explicit admin action that overwrites `accessToken`, not a background
  timer.
- **NATS event-bus pipeline.** `IngressService.processInbound()` takes one
  `IProcessInboundOptions` (`tenantId`, `channel`, `provider`, `accountId`,
  `messages`, the causal fields `correlationId`/`causationId`/`depth`, and
  `webhookHeaders`) and branches on none of them — the channel token only ever
  becomes a subject segment.
- **`IChannelProvider` interface.** Both providers implement the interface in
  `packages/shared/src/channel.interfaces.ts`; downstream consumers know only
  the interface.
- **Claim-check.** `packages/database/src/claim-check.ts` operates on the
  generic envelope and is channel-agnostic.

### Adapted — same logic, different structure

`parseWebhook` differs on message path, id, sender, type and echo handling — the
full comparison is the "Parse differences vs WhatsApp" table in Part 2. Note that
account resolution is NOT part of either parser: `WebhookIngressService` narrows
candidates by the instance-addressed URL segment's `externalId`, then tries every
active account's `appSecret` against the signature, and only falls back to a body
hint (`extractMetaPhoneNumberId` for WhatsApp, `extractInstagramBusinessIdHint`
for Instagram) when more than one account verifies. An unresolved ambiguity is
rejected as `signature_mismatch`, never guessed.

`sendMessage` differs as follows:

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| URL | `graph.facebook.com/v21.0/{account.phoneNumberId}/messages` | `graph.instagram.com/v21.0/{account.igUserId}/messages` |
| Text body | `{ messaging_product: "whatsapp", to, type: "text", text: { body } }` | `{ recipient: { id }, message: { text } }` |
| Image body | public URL too — `{ type: "image", image: { link: mediaUrl, caption? } }`; no `media_id` upload step exists | `{ message: { attachment: { type: "image", payload: { url } } } }` |
| Other types | `template` (name + language + components) and `document` are also built | none — anything not `image` falls back to text |
| Auth / transport | `sendMetaMessage` — identical | `sendMetaMessage` — identical |
| Response | `{ messages: [{ id }] }` | `{ message_id }` |

### New — no WhatsApp equivalent

| Component | Why it is new |
|-----------|---------------|
| Echo message filter (`isEchoMessage`) | WhatsApp does not send business-sent echoes |
| `extractInstagramBusinessIdHint` (`recipient.id`) | the WhatsApp sibling reads `metadata.phone_number_id` instead; both live in `webhook-ingress.service.ts`, not in the providers |
| `account.igUserId` as the send-URL segment | WhatsApp uses `account.phoneNumberId` |
| Attachment-driven `type` | WhatsApp reads `messages[].type` directly; Instagram defaults to `"text"` and only changes on `attachments[0].type` |

### Checklist for adding a future channel

1. Create the provider class implementing `IChannelProvider`. Meta channels live
   under `providers/meta/<channel>/<channel>.provider.ts` and extend
   `MetaChannelProviderBase`; non-Meta ones live at
   `providers/<channel>/<channel>.provider.ts` (see `telegram/`, `http/`).
2. Declare `signatureHeader` and `verifySignature` — inherited for free from
   `MetaChannelProviderBase`, written by hand otherwise.
3. Implement `parseWebhook(rawBody) → InboundMessage[]`.
4. Implement `sendMessage(account, message) → Promise<SendMessageResult>`.
5. Register it: a Meta channel goes into `ProviderRegistry`'s map
   (`providers/meta/provider-registry.ts`); anything else is injected into the
   `ChannelRouter` constructor and added to its map.
6. Add the `channel` token to the `Channel` union in
   `packages/shared/src/channel.interfaces.ts` (today
   `"whatsapp" | "instagram" | "telegram" | "http"`), and the family token to
   `ChannelProvider` if it is a new family.
7. If account selection needs a payload hint beyond signature verification, add
   the extractor to `webhook-ingress.service.ts` — otherwise instance-addressed
   URLs and signature verification already resolve the account.
8. The bus, streams, and claim-check work without any changes.
