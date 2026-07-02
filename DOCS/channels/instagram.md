# Instagram Messaging

> **Status:** implemented
> **See also:** [meta-provider-pattern.md](./meta-provider-pattern.md) — WhatsApp/Instagram reuse classification · [channel-service.md](./channel-service.md) — full ingress/egress pipeline

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
| `services/channel-service/src/providers/channel-router.ts` | Provider registry by channel |

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

`account.igUserId` is the IG Professional Account ID (the `id` of `entry[]` in the webhook).

### Parse differences vs WhatsApp

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| Account identifier | `metadata.phone_number_id` | `entry[].id` (= `recipient.id`) |
| Sender identifier | `messages[].from` (phone/BSUID) | `messaging[].sender.id` (IGSID) |
| Message path | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| Echo filter | Not needed | `message.is_echo === true` → skip |
| Status updates | `changes[].value.statuses[]` | Not present |

### `ChannelAccount` fields for Instagram

```typescript
{
  channel: "instagram",
  provider: "meta",
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
