# Problemas resueltos en v0 y cómo evitarlos

Resumen de todo lo que debuggeamos para llegar a una versión funcional. Si arrancás de cero o algo deja de funcionar, revisá esta lista primero.

## 1. El Phone Number ID NO es el número de teléfono

El error más silencioso. Meta usa dos cosas distintas:

```
+1 555 154 1722          ← el número de teléfono (display)
1009049662293548          ← el Phone Number ID (lo que usa la API)
```

En `.env` debe ir el **ID numérico**, no el teléfono:

```
# MAL
META_PHONE_NUMBER_ID=+15551541722

# BIEN
META_PHONE_NUMBER_ID=1009049662293548
```

Dónde encontrarlo: Meta → WhatsApp → API Setup → debajo del número dice "Identificador de número de teléfono".

Si el seed se corrió con el valor incorrecto, la cuenta en MongoDB queda mal y los webhooks no matchean. Para corregirlo:

```bash
mongosh coexistance --eval '
  db.accounts.updateMany({}, { $set: {
    phone_number_id: "1009049662293548",
    waba_id: "1360068825556562",
    display_phone: "+15551541722"
  }})
'
```

## 2. El Access Token se guarda en MongoDB, no solo en .env

Cuando mandás un mensaje desde el frontend, el server usa `account.access_token` de la base de datos, **no** el valor del `.env`. Si regenerás el token en Meta, tenés que actualizar AMBOS:

```bash
# 1. Actualizar .env
META_ACCESS_TOKEN=EAAYBvy...nuevo...

# 2. Actualizar MongoDB
mongosh coexistance --eval '
  db.accounts.updateMany({}, { $set: {
    access_token: "EAAYBvy...nuevo..."
  }})
'

# 3. Reiniciar el server
```

O corré el script que sincroniza todo de una vez:

```bash
cd server && bun src/scripts/fix-account.js
```

Los tokens temporales de Meta duran **24 horas**. Si ves error `401` con código `190`, es esto.

## 3. LOCAL_TESTING debe ser false para conectar con Meta

Con `LOCAL_TESTING=true` (el default), toda la comunicación con Meta se mockea. Es útil para desarrollo sin credenciales, pero cuando querés probar de verdad:

```
LOCAL_TESTING=false
```

Con `false` se activa:
- Envío real de mensajes a WhatsApp
- Validación de firma HMAC en webhooks entrantes
- Token exchange real en Embedded Signup

## 4. El webhook URL cambió respecto al proyecto anterior

```
# Proyecto viejo (Jasper's Market)
https://api.devmachina.net/webhook

# Coexistance
https://api.devmachina.net/api/webhooks/whatsapp
```

Configurar en: Meta → WhatsApp → Configuración → Webhook → URL de devolución de llamada.

## 5. Suscribirse al campo "messages" es obligatorio

Después de verificar el webhook en Meta, hay que activar el toggle de "Suscribirse" en el campo **messages**. Sin esto, Meta no envía ningún evento aunque el webhook esté verificado.

Meta → WhatsApp → Configuración → Campos del webhook → messages → Suscribirse.

## 6. Los números argentinos necesitan normalización

Meta manda los números argentinos con un `9` extra en los webhooks:

```
Webhook recibe:  5491134602008   (con 9 después del 54)
API espera:      541134602008    (sin el 9)
```

`parse-sender-id.js` ya normaliza esto automáticamente. Pero si tenés contactos viejos en la base con el formato incorrecto:

```bash
mongosh coexistance --eval '
  db.contacts.updateMany(
    { wa_id: /^549\d{10}$/ },
    [{ $set: {
      wa_id: { $concat: ["54", { $substr: ["$wa_id", 3, -1] }] },
      phone: { $concat: ["+54", { $substr: ["$phone", 4, -1] }] }
    }}]
  )
'
```

## 7. El WebSocket no pasa por Vite proxy

DEPRECATED — El proyecto ahora usa SSE (Server-Sent Events) via `/api/events/stream` en lugar de WebSocket. Ver `use-event-stream.js`.

En las versiones antiguas, el hook `use-websocket.js` (DEPRECATED) usaba:
```
Dev mode:  ws://localhost:6666/ws    (directo al server)
Prod mode: ws://localhost:6666/ws    (mismo server sirve todo)
```

## 8. "Enviar mensaje" desde Meta NO genera webhook

El botón "Enviar mensaje" en la pantalla de API Setup envía un mensaje DESDE tu Business AL teléfono destino. Eso es una llamada saliente a la API — no dispara webhook.

Para probar el webhook, hay que mandar un mensaje **desde el celular al número de Business** (+1 555 154 1722).

## 9. Test recipients en sandbox

En modo sandbox, Meta solo permite enviar mensajes a números registrados como test recipients. Si ves error `131030`:

```
(#131030) Recipient phone number not in allowed list
```

Andá a Meta → WhatsApp → API Setup → Para → "Administrar lista de números de teléfono" y agregá el número destino.

## Checklist: levantarlo todo desde cero

```
1. Tener MongoDB corriendo
2. .env con valores correctos:
   - META_PHONE_NUMBER_ID = ID numérico (no el teléfono)
   - META_ACCESS_TOKEN = token no expirado
   - META_WABA_ID = WABA ID real
   - LOCAL_TESTING = false (para conectar con Meta)
3. ./setup.sh (o bun install en server/ y client/)
4. bun server/src/scripts/fix-account.js (sincroniza MongoDB con .env)
5. bun server/src/server.js
6. cloudflared tunnel run coexistance (o --url http://localhost:6666)
7. Verificar webhook en Meta con la URL del túnel + /api/webhooks/whatsapp
8. Suscribirse al campo "messages" en Meta
9. cd client && bun run dev (frontend en modo dev)
10. Desde el celular, mandar WhatsApp al +1 555 154 1722
```
