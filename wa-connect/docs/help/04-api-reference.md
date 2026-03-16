# API Reference — WA Connect

Base URL: `http://localhost:6666/api`

Todos los endpoints (excepto health y webhooks) requieren el header:
```
Authorization: Bearer <token>
```

El token lo obtenés al hacer login o register.

---

## Auth

### POST /auth/register

Crea un usuario nuevo.

```bash
curl -X POST http://localhost:6666/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tu@email.com",
    "password": "tu_password",
    "name": "Tu Nombre"
  }'
```

Respuesta:
```json
{
  "user": { "_id": "...", "email": "tu@email.com", "name": "Tu Nombre", "role": "admin" },
  "token": "eyJhbG..."
}
```

### POST /auth/login

```bash
curl -X POST http://localhost:6666/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "christian.carnero@gmail.com",
    "password": "waconnect2024"
  }'
```

Respuesta: igual que register (user + token).

### GET /auth/me

Devuelve el usuario actual.

```bash
curl http://localhost:6666/api/auth/me \
  -H "Authorization: Bearer <token>"
```

---

## Accounts

### GET /accounts

Lista las cuentas de WhatsApp del usuario.

```bash
curl http://localhost:6666/api/accounts \
  -H "Authorization: Bearer <token>"
```

Respuesta:
```json
{
  "accounts": [
    {
      "_id": "...",
      "waba_id": "123456",
      "phone_number_id": "789012",
      "display_phone": "+5411...",
      "business_name": "Mi Negocio",
      "status": "active"
    }
  ]
}
```

Nota: el access_token nunca se expone en las respuestas.

### POST /accounts/connect

Conecta una cuenta manualmente (sandbox/dev).

```bash
curl -X POST http://localhost:6666/api/accounts/connect \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "waba_id": "123456789",
    "phone_number_id": "987654321",
    "access_token": "EAAYBvy...",
    "display_phone": "+5411XXXXXXXX",
    "business_name": "Mi Negocio"
  }'
```

Campos obligatorios: waba_id, phone_number_id, access_token.

### POST /accounts/callback

Callback del Embedded Signup. El frontend envía el code que devuelve FB.login().

```bash
curl -X POST http://localhost:6666/api/accounts/callback \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "AQB...",
    "phone_number_id": "987654321",
    "waba_id": "123456789"
  }'
```

Internamente:
1. Intercambia code → access_token con Meta
2. Obtiene datos del phone number
3. Suscribe webhooks para el WABA
4. Crea la cuenta en MongoDB

### GET /accounts/:accountId/status

```bash
curl http://localhost:6666/api/accounts/ACCOUNT_ID/status \
  -H "Authorization: Bearer <token>"
```

---

## Conversations

### GET /accounts/:accountId/conversations

Lista los contactos con su último mensaje (ordenados por más reciente).

```bash
curl http://localhost:6666/api/accounts/ACCOUNT_ID/conversations \
  -H "Authorization: Bearer <token>"
```

Respuesta:
```json
{
  "conversations": [
    {
      "_id": "contact_id",
      "wa_id": "5215512345678",
      "display_name": "Juan",
      "identifier_type": "phone",
      "last_message": {
        "type": "text",
        "content": { "text": "Hola" },
        "created_at": "2026-03-15T..."
      }
    }
  ]
}
```

### GET /accounts/:accountId/conversations/:contactId

Historial de mensajes con un contacto (paginado, más recientes primero).

```bash
# Últimos 50 mensajes (default)
curl http://localhost:6666/api/accounts/ACCOUNT_ID/conversations/CONTACT_ID \
  -H "Authorization: Bearer <token>"

# Con límite personalizado
curl "http://localhost:6666/api/accounts/ACCOUNT_ID/conversations/CONTACT_ID?limit=100" \
  -H "Authorization: Bearer <token>"
```

---

## Messages

### POST /accounts/:accountId/messages/send

Envía un mensaje de texto.

```bash
curl -X POST http://localhost:6666/api/accounts/ACCOUNT_ID/messages/send \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5215512345678",
    "text": "Hola, gracias por contactarnos!"
  }'
```

Nota: `to` es el wa_id del contacto (su teléfono o BSUID).

Restricción de Meta: solo funciona dentro de la ventana de 24 horas después de que el contacto te escribió. Fuera de esa ventana, usá templates.

### POST /accounts/:accountId/messages/send-template

Envía un template pre-aprobado.

```bash
curl -X POST http://localhost:6666/api/accounts/ACCOUNT_ID/messages/send-template \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5215512345678",
    "template_name": "hello_world",
    "language_code": "en_US",
    "components": []
  }'
```

`components` es un array para variables dinámicas del template (si tiene). Si el template no tiene variables, dejalo como array vacío.

---

## Templates

### GET /accounts/:accountId/templates

Lista los templates aprobados de tu cuenta en Meta.

```bash
curl http://localhost:6666/api/accounts/ACCOUNT_ID/templates \
  -H "Authorization: Bearer <token>"
```

---

## Webhooks

Estos endpoints son para Meta, no para uso manual.

### GET /webhooks/whatsapp

Challenge de verificación. Meta lo llama cuando configurás el webhook URL.

### POST /webhooks/whatsapp

Recibe mensajes entrantes y actualizaciones de estado. Responde 200 inmediatamente y procesa asíncrono.

Para configurar el webhook en Meta:
```
URL:          https://tu-dominio.com/api/webhooks/whatsapp
Verify Token: (el valor de META_VERIFY_TOKEN en tu .env)
Fields:       messages
```

Si estás en desarrollo con Cloudflare Tunnel:
```
URL: https://tu-tunnel.trycloudflare.com/api/webhooks/whatsapp
```

---

## WebSocket

Endpoint: `ws://localhost:6666/ws`

### Autenticación

Después de conectar, enviá:
```json
{ "type": "auth", "token": "eyJhbG..." }
```

Si es válido, recibís:
```json
{ "type": "auth_ok" }
```

Si no te autenticás en 5 segundos, la conexión se cierra.

### Eventos que recibís

Nuevo mensaje entrante:
```json
{
  "type": "new_message",
  "data": {
    "account_id": "...",
    "contact_id": "...",
    "message": { ... }
  }
}
```

Cambio de estado de un mensaje saliente:
```json
{
  "type": "status_update",
  "data": {
    "account_id": "...",
    "wa_message_id": "...",
    "status": "delivered"
  }
}
```

---

## Health Check

```bash
curl http://localhost:6666/api/health
```

```json
{ "status": "ok", "timestamp": "2026-03-15T..." }
```

---

## Códigos de error comunes

| Status | Significado |
|--------|-------------|
| 400    | Datos faltantes o inválidos en el request |
| 401    | Token JWT inválido o expirado |
| 404    | Recurso no encontrado (cuenta, contacto) |
| 502    | Error comunicándose con Meta (token exchange, etc.) |
