# Meta Provider Pattern — WhatsApp/Instagram Reuse

> **Status:** implemented
> **See also:** [instagram.md](./instagram.md) — Instagram-specific detail · [channel-service.md](./channel-service.md) — full provider directory and pipeline

## Overview

WhatsApp and Instagram share the Meta Platform. A significant portion of the `channel-service` implementation is identical or only slightly adapted. This document classifies each component into three categories: **identical** (reused without changes), **adapted** (same logic, different structure), and **new** (no WhatsApp equivalent).

---

## Identical — reused without changes

### Webhook signature verification

Both Meta channels use `x-hub-signature-256` (HMAC-SHA256 with the App Secret). The code lives in `meta-base.ts` and `meta-channel-provider.base.ts` and is shared by both providers:

```typescript
// meta-base.ts — shared
export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

### OAuth token handling

`meta-token.ts` manages Meta OAuth token exchange and refresh. The `fb_exchange_token` mechanism works identically for WhatsApp and Instagram.

### NATS event bus pipeline

The publishing pipeline to NATS JetStream (`ingress.service.ts`) is completely channel-agnostic. It receives `channel`, `provider`, and `messages: InboundMessage[]` — it has no knowledge of which channel is in use.

### `IChannelProvider` interface

Both providers implement the same interface defined in `packages/shared/src/channel.interfaces.ts`. Downstream consumers only know the interface, not the implementation.

### Claim-check

The claim-check mechanism for large payloads (`packages/database/src/claim-check.ts`) operates on the generic envelope — channel-agnostic.

---

## Adapted — same logic, different structure

### `parseWebhook`

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| Message path | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| Account ID | `metadata.phone_number_id` | `entry[].id` / `recipient.id` |
| Sender ID | `messages[].from` (phone/BSUID) | `messaging[].sender.id` (IGSID) |
| Status updates | `changes[].value.statuses[]` | Not present |
| Echo filter | Not needed | `message.is_echo === true` → skip |
| Output | `InboundMessage[]` | `InboundMessage[]` (same format) |

### `sendMessage`

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| URL | `graph.facebook.com/v21.0/{phone_id}/messages` | `graph.instagram.com/v21.0/{ig_id}/messages` |
| Text body | `{ messaging_product: "whatsapp", to, type: "text", text: { body } }` | `{ recipient: { id }, message: { text } }` |
| Image body | Requires `media_id` upload first | Public URL directly |
| Auth | `Authorization: Bearer` | `Authorization: Bearer` (identical) |
| Response | `{ messages: [{ id }] }` | `{ message_id }` |

---

## New — no WhatsApp equivalent

| Component | Why it is new |
|-----------|---------------|
| Echo message filter | WhatsApp does not send business-sent echoes |
| `ig_user_id` extraction from `recipient.id` | WhatsApp uses `phone_number_id` from `metadata` |
| `account.igUserId` as account identifier | WhatsApp uses `account.phoneNumberId` |
| Absence of status updates | WhatsApp has `statuses[]`; Instagram has no delivery receipts |

---

## Checklist for adding a future channel

1. Create `providers/<provider>/<channel>/<channel>.provider.ts` implementing `IChannelProvider`.
2. Define `signatureHeader` and the `verifySignature` logic.
3. Implement `parseWebhook(rawBody) → InboundMessage[]`.
4. Implement `sendMessage(account, message) → Promise<SendMessageResult>`.
5. Register the provider in `channel-router.ts`.
6. Add the `channel` token to the `Channel` type in `packages/shared/src/channel.interfaces.ts`.
7. The bus, streams, and claim-check work without any changes.
