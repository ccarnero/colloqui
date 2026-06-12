# 07 — Instagram: Implementación

> **Estado:** implementado
> **Prerequisitos:** [06-overview-instagram-api.md](./06-overview-instagram-api.md)

## Archivos de implementación

| Archivo | Responsabilidad |
|---------|----------------|
| `services/channel-service/src/providers/meta/instagram/instagram.provider.ts` | Provider principal: `parseWebhook`, `sendMessage` |
| `services/channel-service/src/providers/meta/meta-channel-provider.base.ts` | Base compartida Meta: `verifySignature`, `buildSendPayload` |
| `services/channel-service/src/providers/meta/meta-base.ts` | `verifyWebhookSignature` (HMAC-SHA256), `sendMetaMessage` |
| `services/channel-service/src/providers/channel-router.ts` | Registry de providers por canal |

## Parse de webhook (`parseWebhook`)

```typescript
// instagram.provider.ts
parseWebhook(rawBody: Record<string, unknown>): InboundMessage[] {
  const messages: InboundMessage[] = [];
  const entry = rawBody.entry as Array<Record<string, unknown>>;
  for (const e of entry) {
    const messaging = e.messaging as Array<Record<string, unknown>>;
    for (const event of messaging) {
      if (this.isEchoMessage(event)) continue;  // filtro de echo
      const parsed = this.parseInstagramMessage(event);
      if (parsed) messages.push(parsed);
    }
  }
  return messages;
}
```

### Lookup de cuenta en webhook

La cuenta se identifica por `ig_user_id`, que se extrae de `entry[].messaging[].recipient.id`:

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

`channel-service` busca el `ChannelAccount` activo cuyo `igUserId === recipient.id` para el tenant.

## Verificación de firma

Instagram usa el mismo header y mecanismo que WhatsApp:

```
Header: x-hub-signature-256
Valor:  sha256=<hmac-sha256(rawBody, appSecret)>
```

El código de verificación es compartido con WhatsApp via `meta-channel-provider.base.ts`:

```typescript
readonly signatureHeader = "x-hub-signature-256";

verifySignature(rawBody: Uint8Array, signature: string, secret: string): boolean {
  return verifyWebhookSignature(Buffer.from(rawBody), signature, secret);
}
```

La comparación usa `timingSafeEqual` para prevenir timing attacks.

## Envío de mensajes (`sendMessage`)

**Texto:**
```typescript
// instagram.provider.ts
async sendMessage(account: ChannelAccount, message: OutboundMessage) {
  const url = `https://graph.instagram.com/v21.0/${account.igUserId}/messages`;
  const body = { recipient: { id: message.to }, message: { text: message.text } };
  return sendMetaMessage({ url, token: account.accessToken, body, ... });
}
```

**Imagen:**
```typescript
const body = {
  recipient: { id: message.to },
  message: {
    attachment: { type: "image", payload: { url: message.mediaUrl } }
  }
};
```

El campo `account.igUserId` corresponde al IG Professional Account ID (el `id` del `entry[]` en el webhook).

## Diferencias de parseo vs WhatsApp

| Aspecto | WhatsApp | Instagram |
|---------|----------|-----------|
| Account identifier | `metadata.phone_number_id` | `entry[].id` (= `recipient.id`) |
| Sender identifier | `messages[].from` (phone/BSUID) | `messaging[].sender.id` (IGSID) |
| Message path | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| Echo filter | No existe | `message.is_echo === true` → skip |
| Status updates | `changes[].value.statuses[]` | No existen |

## Modelo de cuenta Instagram

El `ChannelAccount` para Instagram usa estos campos específicos:

```typescript
{
  channel: "instagram",
  provider: "meta",
  igUserId: "17841400...",    // IG Professional Account ID
  accessToken: "...",         // Instagram User Access Token
  appSecret: "...",           // para verificar firma de webhook
  verifyToken: "...",         // para challenge GET de verificación
}
```

## Subject NATS emitido

```
evt.<tenant>.channel-service.messaging.instagram.meta.received.v1
```

El `channel` en el subject permite a los consumers downstream filtrar por canal sin inspeccionar el payload.

## Siguiente paso

→ [08-reutilizacion-patrones-whatsapp.md](./08-reutilizacion-patrones-whatsapp.md)
