# 08 — Reutilización de Patrones WhatsApp

> **Estado:** implementado
> **Prerequisitos:** [07-instagram-implementacion.md](./07-instagram-implementacion.md)

## Resumen

Instagram y WhatsApp comparten la plataforma Meta. Una porción significativa del código es idéntica o ligeramente adaptada. Este documento clasifica cada componente en **idéntico** (reutilizado sin cambios), **adaptado** (misma lógica, estructura diferente), y **nuevo** (sin equivalente en WhatsApp).

## Idéntico — reutilizado sin cambios

### Verificación de firma de webhook

Ambos canales Meta usan `x-hub-signature-256` (HMAC-SHA256 con el App Secret). El código está en `meta-base.ts` y `meta-channel-provider.base.ts`, compartido por WhatsApp e Instagram:

```typescript
// meta-base.ts — compartido
export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

### Token OAuth

`meta-token.ts` maneja el intercambio y refresh de tokens OAuth de Meta. El mecanismo `fb_exchange_token` funciona igual para WhatsApp e Instagram.

### Bus de eventos

El pipeline de publicación a NATS JetStream (`ingress.service.ts`) es completamente channel-agnostic. Recibe `channel`, `provider`, y `messages: InboundMessage[]` — no necesita saber qué canal usa.

### Interfaz `IChannelProvider`

Ambos providers implementan la misma interfaz definida en `packages/shared/src/channel.interfaces.ts`. Los consumers downstream solo conocen la interfaz, no la implementación.

### Claim-check

El mecanismo de claim-check para payloads grandes (`packages/database/src/claim-check.ts`) opera sobre el envelope genérico — channel-agnostic.

## Adaptado — misma lógica, estructura diferente

### `parseWebhook`

| Aspecto | WhatsApp | Instagram |
|---------|----------|-----------|
| Ruta al mensaje | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| Account ID | `metadata.phone_number_id` | `entry[].id` / `recipient.id` |
| Sender ID | `messages[].from` (phone/BSUID) | `messaging[].sender.id` (IGSID) |
| Status updates | `changes[].value.statuses[]` | No existen |
| Echo filter | No necesario | `message.is_echo === true` → skip |
| Output | `InboundMessage[]` | `InboundMessage[]` (mismo formato) |

### `sendMessage`

| Aspecto | WhatsApp | Instagram |
|---------|----------|-----------|
| URL | `graph.facebook.com/v21.0/{phone_id}/messages` | `graph.instagram.com/v21.0/{ig_id}/messages` |
| Body de texto | `{ messaging_product: "whatsapp", to, type: "text", text: { body } }` | `{ recipient: { id }, message: { text } }` |
| Body de imagen | Upload de media_id | URL pública directa |
| Auth | `Authorization: Bearer` | `Authorization: Bearer` (igual) |
| Response | `{ messages: [{ id }] }` | `{ message_id }` |

## Nuevo — sin equivalente en WhatsApp

| Componente | Por qué es nuevo |
|-----------|------------------|
| Filtro de echo messages | WhatsApp no envía echos del negocio |
| Extracción de `ig_user_id` de `recipient.id` | WhatsApp usa `phone_number_id` de `metadata` |
| `account.igUserId` como identificador | WhatsApp usa `account.phoneNumberId` |
| Ausencia de status updates | WhatsApp tiene `statuses[]`; Instagram no tiene delivery receipts |

## Checklist para agregar un canal futuro

Si se agrega un canal nuevo (ej: Telegram ya está, pero si se agregara Email u otro):

1. Crear `providers/<provider>/<channel>/<channel>.provider.ts` implementando `IChannelProvider`
2. Definir `signatureHeader` y la lógica de `verifySignature`
3. Implementar `parseWebhook(rawBody) → InboundMessage[]`
4. Implementar `sendMessage(account, message) → Promise<SendMessageResult>`
5. Registrar en `channel-router.ts`
6. Agregar el `channel` al tipo `Channel` en `packages/shared/src/channel.interfaces.ts`
7. El bus, los streams y el claim-check funcionan sin cambios
