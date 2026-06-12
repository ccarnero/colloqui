# Usar el Dashboard — Yoizen Platform

## Acceso

El dashboard de administración se sirve desde `admin-console` (Angular). En desarrollo local:

```
http://admin-console.platform-services-dev.dev.local
```

O via port-forward (si está configurado):

```
http://localhost:<port-del-admin-console>
```

## Login

Credenciales del tenant correspondiente (creadas con `setup-tenant.sh` o manualmente via `POST /auth/tenant-users`).

## Gestión de cuentas de canal

Desde el dashboard se pueden:

- **Listar** cuentas de canal activas del tenant
- **Conectar** una cuenta nueva (WhatsApp, Instagram, Telegram)
- **Actualizar** credenciales (token, app secret)
- **Refrescar token** OAuth (para cuentas Meta con token expirado)
- **Desactivar** una cuenta

Al conectar una cuenta WhatsApp necesitás los IDs del Meta Developer Dashboard — ver [02-meta-dashboard.md](./02-meta-dashboard.md).

## Conversaciones y mensajes

El dashboard de mensajería (`messaging-console`) permite:

- Ver conversaciones activas por cuenta
- Leer historial de mensajes por contacto
- Enviar mensajes de texto, templates (WhatsApp) e imágenes
- Ver estado de entrega en tiempo real via SSE

### Actualizaciones en tiempo real

El dashboard se suscribe al endpoint SSE `GET /channels/stream` con el JWT del usuario. Cuando llega un mensaje nuevo o cambia el estado de uno existente, el evento llega por SSE sin necesidad de polling.

```
GET /channels/stream?kinds=received,sent
Authorization: Bearer <JWT>
x-yoizen-tenant: acme
```

El SSE usa la conexión nativa de `EventSource` del browser. Se reconecta automáticamente si se cae.

## Reglas de auto-reply

Desde el dashboard se pueden configurar reglas de respuesta automática por cuenta:

- **Trigger pattern**: texto o expresión regular que activa la regla
- **Reply text**: respuesta a enviar

Las reglas se gestionan vía `POST /channels/auto-reply` y `GET /channels/auto-reply?accountId=...`.

## Templates (WhatsApp)

Los templates son mensajes pre-aprobados por Meta. Solo disponibles para cuentas WhatsApp. Se usan para:

- Iniciar conversaciones fuera de la ventana de 24 horas
- Notificaciones proactivas

Los templates se crean/editan en el Meta Developer Dashboard → WhatsApp → Message Templates.

## Flujo típico de recepción

```
1. Un contacto escribe por WhatsApp / Instagram / Telegram
      ↓
2. El webhook llega a /webhooks/:channel/:tenantId
      ↓
3. api-gateway publica en INGRESS-<TENANT>
      ↓
4. channel-service verifica HMAC, parsea, publica evento canónico
      ↓
5. El evento llega al dashboard por SSE
      ↓
6. El operador ve el mensaje y responde
      ↓
7. POST /channels/:accountId/messages → channel-service → provider API
```
