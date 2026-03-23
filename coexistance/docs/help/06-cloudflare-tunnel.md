# Exponer tu servidor local con Cloudflare Tunnel

Meta necesita una URL pública HTTPS para enviarte los webhooks de WhatsApp. Cloudflare Tunnel crea un túnel seguro desde internet a tu máquina local, sin abrir puertos ni tocar tu router.

## Cómo funciona

```
WhatsApp Cloud API                       Tu Mac
       │                                    │
       │  POST /api/webhooks/whatsapp       │
       ▼                                    │
  Cloudflare DNS                            │
  (api.devmachina.net)                      │
       │                                    │
       ▼                                    │
  Cloudflare Edge ─── túnel encriptado ──► cloudflared
       │                                    │
       │                                    ▼
       │                              localhost:6666
       │                              (Express + WS)
       │                                    │
       │                                    ▼
       │                                 MongoDB
```

El flujo paso a paso (de tu proyecto anterior con `devmachina.net`):

1. Meta resuelve `api.devmachina.net` → los nameservers de Cloudflare (`mallory.ns.cloudflare.com`, `ruben.ns.cloudflare.com`) responden con IPs del edge
2. Meta envía POST al edge de Cloudflare
3. Cloudflare identifica que `api.devmachina.net` tiene un CNAME al túnel y reenvía por el túnel encriptado
4. `cloudflared` en tu Mac recibe el request y lo forwardea a `http://localhost:6666`
5. Express procesa, guarda en MongoDB, y broadcastea por WebSocket

## Paso 1 — Instalar cloudflared

### macOS

```bash
brew install cloudflared
```

### Linux (Debian/Ubuntu)

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb
```

### Verificar

```bash
cloudflared --version
```

## Paso 2 — Decidir: túnel rápido o túnel con nombre fijo

Hay dos opciones. Si solo querés probar algo rápido, usá la opción A. Si vas a desarrollar seguido (recomendado), usá la opción B — que es lo que tenías configurado con `devmachina.net`.

### Opción A: Túnel rápido (temporal)

```bash
cloudflared tunnel --url http://localhost:6666
```

Te da una URL tipo `https://random-words.trycloudflare.com`. Cambia cada vez que reiniciás, así que tenés que reconfigurar el webhook en Meta cada vez. Solo sirve para una prueba puntual.

### Opción B: Túnel con nombre fijo (como tu setup con devmachina.net)

Esto es lo que ya tenías funcionando. Creás el túnel una vez y la URL nunca cambia.

#### 2.1 — Login en Cloudflare (una sola vez)

```bash
cloudflared tunnel login
```

Se abre el browser, elegís tu cuenta de Cloudflare. Esto guarda las credenciales en `~/.cloudflared/cert.pem`.

#### 2.2 — Crear el túnel (una sola vez)

```bash
cloudflared tunnel create coexistance
```

La salida te muestra el **Tunnel ID** (un UUID). Guardalo. También crea el archivo de credenciales en `~/.cloudflared/<tunnel-id>.json`.

#### 2.3 — Rutear el DNS al túnel (una sola vez)

Acá le decís a Cloudflare que cuando llegue tráfico a tu subdominio, lo mande por el túnel. Necesitás un dominio que ya tengas en Cloudflare (ej: `devmachina.net`).

```bash
# Esto crea un registro CNAME automáticamente en tu zona DNS
cloudflared tunnel route dns coexistance api.devmachina.net
```

Podés verificar en el dashboard de Cloudflare → DNS → que aparezca:

```
CNAME   api   <tunnel-id>.cfargotunnel.com   Proxied
```

#### 2.4 — Crear el archivo de configuración

```bash
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: coexistance
credentials-file: /Users/chris/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: api.devmachina.net
    service: http://localhost:6666
  - service: http_status:404
EOF
```

IMPORTANTE: Reemplazá `<tunnel-id>` con el UUID real del paso 2.2. La sección `ingress` necesita siempre una regla catch-all al final (`http_status:404`).

#### 2.5 — Levantar el túnel

```bash
cloudflared tunnel run coexistance
```

A partir de ahora, `https://api.devmachina.net` apunta a tu `localhost:6666`. No cambia nunca.

Para verificar que funciona:

```bash
curl https://api.devmachina.net/api/health
# {"status":"ok","timestamp":"2026-03-16T..."}
```

## Paso 3 — Cambiar LOCAL_TESTING a false

Este paso es clave. Con `LOCAL_TESTING=true` (el default), todo se mockea y el webhook verifica pero los mensajes no se procesan como reales. Para recibir mensajes de verdad:

Editá tu `.env`:

```
LOCAL_TESTING=false
```

Y reiniciá el server. Cuando `LOCAL_TESTING=false`:

- Se valida la firma HMAC SHA-256 del webhook (usa META_APP_SECRET)
- Las llamadas a la Graph API de Meta son reales
- El token exchange en Embedded Signup es real
- Los mensajes se envían de verdad por WhatsApp

Asegurate de que estos valores estén correctos en `.env`:

```
META_APP_ID=1690770278576601
META_APP_SECRET=<tu app secret real>
META_VERIFY_TOKEN=<tu verify token>
META_ACCESS_TOKEN=<access token válido, no expirado>
META_PHONE_NUMBER_ID=<phone number ID de Meta, no el número de teléfono>
META_WABA_ID=<tu WABA ID>
```

## Paso 4 — Configurar el webhook en Meta

1. Andá a https://developers.facebook.com → tu app → WhatsApp → Configuration
2. En la sección "Webhook", hacé clic en "Edit"
3. Completá:

```
┌─────────────────┬──────────────────────────────────────────────────────────┐
│ Callback URL     │ https://api.devmachina.net/api/webhooks/whatsapp       │
│ Verify token     │ (el mismo valor que META_VERIFY_TOKEN en tu .env)       │
└─────────────────┴──────────────────────────────────────────────────────────┘
```

ATENCIÓN con la ruta: en el proyecto anterior era `/webhook`. En Coexistance es `/api/webhooks/whatsapp`. Si la ponés mal, Meta va a devolver error de verificación.

4. Hacé clic en "Verify and Save"

Lo que pasa internamente:

```
Meta → GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=12345
Tu server → verifica que hub.verify_token coincide → responde 200 con "12345"
Meta → ✓ Verificado
```

## Paso 5 — Suscribir eventos (obligatorio)

Después de verificar, Meta NO manda nada todavía. Tenés que suscribirte a los campos de webhook.

En la misma página de Configuration → Webhook fields, hacé clic en "Subscribe" para:

```
┌──────────────────────────────┬──────────┬─────────────────────────────────────┐
│ Campo                        │ Acción   │ Qué recibís                         │
├──────────────────────────────┼──────────┼─────────────────────────────────────┤
│ messages                     │ Suscribir│ Mensajes entrantes + status updates │
│ message_template_status_     │ Suscribir│ Cuando aprueban/rechazan templates  │
│   update                     │          │                                     │
└──────────────────────────────┴──────────┴─────────────────────────────────────┘
```

Sin suscribirte a `messages`, no llega nada. Es el error más común.

## Paso 6 — Probar el flujo completo

### Checklist antes de probar

```
✓ cloudflared tunnel run coexistance está corriendo
✓ bun server/src/server.js está corriendo
✓ LOCAL_TESTING=false en .env
✓ curl https://api.devmachina.net/api/health devuelve {"status":"ok"}
✓ Webhook verificado en Meta (paso 4)
✓ Suscrito al campo "messages" (paso 5)
✓ Access token no expirado (temporales duran 24h)
✓ Si estás en sandbox: el número que va a mandar mensajes está en la lista de test recipients
  (Meta → WhatsApp → API Setup → "To" → "Manage phone number list")
```

### Prueba

1. Levantá el server: `bun server/src/server.js`
2. Levantá el túnel: `cloudflared tunnel run coexistance`
3. Abrí Coexistance en el browser (http://localhost:5173 en dev)
4. Logueate y verificá que tu cuenta WABA está conectada
5. Desde un celular, mandá un mensaje de WhatsApp al número de Business configurado
6. En la terminal del server vas a ver:

```
  Incoming webhook: messages
  Saved message from +549XXXXXXXXX
  Broadcasting new_message to account <account_id>
```

7. En el browser, la conversación aparece en el sidebar en tiempo real via WebSocket

## Orden de levantamiento (resumen)

Tres terminales:

```
Terminal 1: MongoDB
  mongod                          # si no está como servicio

Terminal 2: Cloudflare Tunnel
  cloudflared tunnel run coexistance

Terminal 3: Coexistance Server
  cd coexistance
  bun server/src/server.js

Terminal 4 (opcional): Frontend dev
  cd coexistance/client
  npx vite
```

O todo junto con el script:

```bash
#!/bin/bash
# dev.sh — levanta server + tunnel en paralelo
set -e

cd "$(dirname "$0")"

echo "==> Starting server..."
bun server/src/server.js &
SERVER_PID=$!

sleep 2
curl -sf http://localhost:6666/api/health > /dev/null || {
  echo "!! Server failed to start"
  kill $SERVER_PID 2>/dev/null
  exit 1
}
echo "==> Server running on :6666"

echo "==> Starting Cloudflare tunnel..."
echo "    (Ctrl+C to stop everything)"
cloudflared tunnel run coexistance

# Cleanup al cerrar
kill $SERVER_PID 2>/dev/null
echo "==> Done."
```

```bash
chmod +x dev.sh
./dev.sh
```

## Troubleshooting

### "Verify and Save" falla en Meta

```
✓ cloudflared está corriendo (cloudflared tunnel run coexistance)
✓ El server Express está corriendo en el puerto 6666
✓ La URL termina en /api/webhooks/whatsapp
  (en el proyecto anterior era /webhook — no confundir)
✓ El verify token coincide EXACTAMENTE con META_VERIFY_TOKEN en tu .env
✓ curl https://api.devmachina.net/api/health devuelve 200
```

### No llegan mensajes después de verificar

```
✓ Te suscribiste al campo "messages" (Paso 5) — sin esto no llega nada
✓ LOCAL_TESTING=false en .env
✓ El número sender está en test recipients (si estás en sandbox)
✓ El access token no expiró (temporales duran 24h, regenerá en API Setup)
✓ META_APP_SECRET es correcto (se usa para validar la firma HMAC)
```

### La firma del webhook falla (403 o silencio)

Cuando `LOCAL_TESTING=false`, el server valida la firma HMAC SHA-256 de cada POST de Meta usando `META_APP_SECRET`. Si el secret está mal:

```
✓ Verificá que META_APP_SECRET en .env coincide con App Dashboard → Settings → Basic → App Secret
✓ Copiá el valor de nuevo — a veces se corta al copiar
✓ Reiniciá el server después de cambiar .env
```

### El mensaje llega al server pero no al browser

```
✓ WebSocket conectado (consola del browser: "WS connected")
✓ En dev mode (Vite en :5173), el WS conecta directo a :6666
✓ El JWT token no expiró
✓ La cuenta del mensaje coincide con una cuenta del usuario logueado
```

### cloudflared se desconecta / "connection reset"

```
✓ Verificá tu conexión a internet
✓ cloudflared reconnecta automáticamente — esperá unos segundos
✓ Si persiste: cloudflared tunnel cleanup coexistance y volver a correr
✓ Para sesiones largas, usá tmux:
    tmux new -s tunnel
    cloudflared tunnel run coexistance
    (Ctrl+B, D para detach — sigue corriendo)
    tmux attach -t tunnel  (para volver)
```

### Ya tenía un túnel viejo con otro nombre

Si tu túnel anterior se llamaba `whatsapp-dev` (como en el proyecto de Jasper's Market):

```bash
# Ver túneles existentes
cloudflared tunnel list

# Podés reusar el viejo cambiando el config.yml
# o crear uno nuevo (coexistance) y rutear el DNS al nuevo
cloudflared tunnel route dns coexistance api.devmachina.net
```

Cloudflare actualiza el CNAME automáticamente al nuevo túnel.
