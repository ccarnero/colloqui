# API Reference — Yoizen Platform

Base URL (dev local): `http://localhost:8080`

O via hostname: `http://api-gateway.platform-services-dev.dev.local`

Todos los endpoints (excepto health y webhooks) requieren:
```
Authorization: Bearer <token>
x-yoizen-tenant: <tenant-id>
```

El token se obtiene con `POST /auth/login` o `POST /auth/token`.

---

## Auth

### POST /auth/login

Obtiene un access token con email + password.

```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -H "x-yoizen-tenant: acme" \
  -d '{ "email": "admin@acme.com", "password": "..." }'
```

Respuesta:
```json
{
  "access_token": "eyJhbG...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "tenant:acme"
}
```

### POST /auth/token

Autenticación con client credentials (machine-to-machine).

### POST /auth/refresh

Refresca un access token usando el refresh token.

### Gestión de usuarios del tenant

```
POST   /auth/tenant-users           ← crear usuario en el tenant
GET    /auth/tenant-users           ← listar usuarios del tenant
GET    /auth/tenant-users/:id
PATCH  /auth/tenant-users/:id
DELETE /auth/tenant-users/:id
```

---

## Tenants

Estos endpoints requieren un token de plataforma (`scope: "platform"`).

```
POST   /tenants             ← crear tenant (provisiona K8s namespace + Postgres)
GET    /tenants             ← listar tenants
GET    /tenants/:nameOrId
PATCH  /tenants/:name
DELETE /tenants/:name
```

### POST /tenants

```bash
curl -X POST http://localhost:8080/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "acme" }'
```

---

## Channels (Cuentas de canal)

### POST /channels/accounts

Conecta una cuenta de canal.

```bash
# WhatsApp
curl -X POST http://localhost:8080/channels/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "whatsapp",
    "name": "Mi negocio WA",
    "phoneNumberId": "987654321",
    "wabaId": "123456789",
    "accessToken": "EAAYBvy...",
    "appSecret": "f0b2f677...",
    "verifyToken": "mi_verify_token"
  }'
```

```bash
# Instagram
curl -X POST http://localhost:8080/channels/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "instagram",
    "name": "Mi negocio IG",
    "igUserId": "17841400...",
    "accessToken": "EAAYBvy...",
    "appSecret": "f0b2f677...",
    "verifyToken": "mi_verify_token"
  }'
```

```bash
# Telegram
curl -X POST http://localhost:8080/channels/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "telegram",
    "name": "Mi bot",
    "telegramBotToken": "123456:ABC-..."
  }'
```

### GET /channels/accounts

Lista las cuentas de canal activas del tenant.

### GET /channels/accounts/:id

### PATCH /channels/accounts/:id

Actualiza credenciales (access token, app secret, etc.).

### POST /channels/accounts/:id/refresh-token

Refresca el token OAuth de una cuenta Meta.

### DELETE /channels/accounts/:id

---

## Messages

### POST /channels/:accountId/messages

Envía un mensaje.

```bash
# Texto
curl -X POST http://localhost:8080/channels/ACCOUNT_ID/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d '{ "to": "5215512345678", "type": "text", "text": "Hola!" }'
```

```bash
# Template WhatsApp
curl -X POST http://localhost:8080/channels/ACCOUNT_ID/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5215512345678",
    "type": "template",
    "templateName": "hello_world",
    "templateLanguage": "en_US",
    "templateComponents": []
  }'
```

Tipos soportados: `text`, `template` (solo WhatsApp), `image`, `document`.

Respuesta:
```json
{ "success": true, "providerMessageId": "wamid.xxx", "timestamp": "..." }
```

---

## Webhooks (endpoints públicos para providers)

No requieren JWT. El tenant se resuelve del path.

### GET /webhooks/:channel/:tenantId

Verificación del webhook (hub.challenge). Meta y Telegram llaman esto al configurar el webhook.

```
GET /webhooks/whatsapp/acme?hub.mode=subscribe&hub.verify_token=...&hub.challenge=12345
→ 200 "12345"
```

### POST /webhooks/:channel/:tenantId

Recibe eventos del provider. Responde 200 inmediatamente y publica en JetStream de forma asíncrona.

```
POST /webhooks/whatsapp/acme
POST /webhooks/instagram/acme
POST /webhooks/telegram/acme
```

---

## SSE — Server-Sent Events

### GET /channels/stream

Stream de eventos de canal en tiempo real.

```bash
curl -N "http://localhost:8080/channels/stream?kinds=received,sent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: acme"
```

Parámetro `kinds`: comma-separated con valores `received`, `sent`, `delivered`, `read`, `failed`. Omitir = todos.

Cada evento:
```
data: {"channel":"whatsapp","provider":"meta","kind":"received","accountid":"...","payload":{...}}
```

La conexión se reconecta automáticamente (nativo de EventSource / fetch SSE).

---

## Auto-reply

### POST /channels/auto-reply

Crea una regla de respuesta automática.

```bash
curl -X POST http://localhost:8080/channels/auto-reply \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "ACCOUNT_ID",
    "channel": "whatsapp",
    "triggerPattern": "ping",
    "replyText": "pong"
  }'
```

### GET /channels/auto-reply?accountId=ACCOUNT_ID

Lista reglas de auto-reply de una cuenta.

### DELETE /channels/auto-reply/:id

---

## Health

### GET /health

```bash
curl http://localhost:8080/health
```

Respuesta incluye estado de NATS, Redis y servicios downstream.

### GET /readyz

Readiness probe (usado por Kubernetes).

---

## Códigos de error comunes

| Status | Significado |
|--------|-------------|
| 400 | Datos inválidos o faltantes |
| 401 | Token JWT inválido o expirado |
| 403 | Tenant del token no coincide con el request |
| 404 | Recurso no encontrado |
| 503 | JetStream bajo presión (webhook publish) — reintentar |
