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
  const expectedSig = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = `sha256=${expectedSig}`;
  if (signature.length !== expected.length) return false;   // timingSafeEqual throws on length mismatch
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

`MetaChannelProviderBase` declares `signatureHeader = "x-hub-signature-256"` and its
`verifySignature()` delegates to the function above, so neither concrete provider
implements verification itself.

### Outbound HTTP send

`sendMetaMessage()` in `meta-base.ts` performs every Graph API POST for both
channels: `Authorization: Bearer <account.accessToken>`,
`Content-Type: application/json`, a 10 s `AbortSignal.timeout`, and uniform
error/`SendMessageResult` shaping. Each provider supplies only the URL, the JSON
body and a `parseSuccessBody` callback that pulls the provider message id out of
the channel-specific response.

### OAuth token handling

`exchangeForLongLivedToken()` in `meta-token.ts` trades a short-lived token for a
long-lived one via the `fb_exchange_token` grant on `graph.facebook.com/v22.0`
(the token endpoint is one version ahead of the send endpoints' `v21.0`). It is
called from `AccountsService`, which rejects the request unless
`account.provider === "meta"` — so the same code path serves WhatsApp and
Instagram. Refresh is explicit (an admin action that overwrites `accessToken`),
not a background timer.

### NATS event bus pipeline

The publishing pipeline to NATS JetStream (`ingress.service.ts`) is completely channel-agnostic. `IngressService.processInbound()` takes one `IProcessInboundOptions` object — `tenantId`, `channel`, `provider`, `accountId`, `messages: InboundMessage[]`, plus the causal fields (`correlationId`, `causationId`, `depth`) and `webhookHeaders` — and branches on none of them: the channel token only ever becomes a subject segment.

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
| Message id | `messages[].id` | `messaging[].message.mid` |
| Sender ID | `messages[].from`, run through `normalizeRecipient` | `messaging[].sender.id` (IGSID), verbatim |
| Type | taken from `messages[].type` (`text`/`image`/`video`/`audio`/`document`) | always `"text"` unless `message.attachments[0]` overrides it |
| Status updates | **not parsed** — `parseWebhook` reads only `value.messages`; `value.statuses[]` is ignored | not sent by the channel |
| Echo filter | Not needed | `message.is_echo === true` → skip |
| Output | `InboundMessage[]` | `InboundMessage[]` (same format) |

> **Account resolution is NOT part of `parseWebhook`.** Neither provider extracts an
> account identifier from the payload. `WebhookIngressService` picks the account: the
> instance-addressed URL segment narrows candidates by `externalId`, then every active
> account's `appSecret` is tried against the signature. Only when more than one account
> verifies does it fall back to a body hint — `extractMetaPhoneNumberId`
> (`entry[0].changes[0].value.metadata.phone_number_id` vs `account.phoneNumberId`) for
> WhatsApp and `extractInstagramBusinessIdHint` (`entry[].messaging[].recipient.id` vs
> `account.igUserId`) for Instagram. An unresolved ambiguity is rejected as
> `signature_mismatch`, never guessed.

### `sendMessage`

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| URL | `graph.facebook.com/v21.0/{account.phoneNumberId}/messages` | `graph.instagram.com/v21.0/{account.igUserId}/messages` |
| Text body | `{ messaging_product: "whatsapp", to, type: "text", text: { body } }` | `{ recipient: { id }, message: { text } }` |
| Image body | public URL too — `{ type: "image", image: { link: mediaUrl, caption? } }`; no `media_id` upload step exists | `{ message: { attachment: { type: "image", payload: { url } } } }` |
| Other types | `template` (name + language + components) and `document` are also built | none — anything not `image` falls back to text |
| Auth / transport | both go through `sendMetaMessage` — identical | both go through `sendMetaMessage` — identical |
| Response | `{ messages: [{ id }] }` | `{ message_id }` |

---

## New — no WhatsApp equivalent

| Component | Why it is new |
|-----------|---------------|
| Echo message filter (`isEchoMessage`) | WhatsApp does not send business-sent echoes |
| `extractInstagramBusinessIdHint` (`recipient.id`) | the WhatsApp sibling reads `metadata.phone_number_id` instead; both live in `webhook-ingress.service.ts`, not in the providers |
| `account.igUserId` as the send-URL segment | WhatsApp uses `account.phoneNumberId` |
| Attachment-driven `type` | WhatsApp reads `messages[].type` directly; Instagram defaults to `"text"` and only changes on `attachments[0].type` |

---

## Checklist for adding a future channel

1. Create the provider class implementing `IChannelProvider`. Meta channels live under
   `providers/meta/<channel>/<channel>.provider.ts` and extend `MetaChannelProviderBase`;
   non-Meta ones live at `providers/<channel>/<channel>.provider.ts` (see `telegram/`, `http/`).
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
7. If account selection needs a payload hint beyond signature verification, add the
   extractor to `webhook-ingress.service.ts` — otherwise instance-addressed URLs and
   signature verification already resolve the account.
8. The bus, streams, and claim-check work without any changes.
