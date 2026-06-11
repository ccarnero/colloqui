# Exponer el cluster local con Cloudflare Tunnel

Meta y Telegram necesitan una URL pública HTTPS para enviarte los webhooks. Cloudflare Tunnel crea un túnel seguro desde internet hasta tu cluster local (OrbStack/minikube), sin abrir puertos ni tocar tu router.

## Cómo funciona

```
Provider externo (Meta/Telegram)
  │
  ▼  POST /webhooks/:channel/:tenantId
Cloudflare Edge
  │  túnel encriptado
  ▼
cloudflared (en tu Mac)
  │
  ▼  http://localhost:8080
port-forward de kubectl
  │
  ▼
api-gateway (K8s, namespace platform-services-dev)
```

El port-forward expone `api-gateway` en `localhost:8080`. El túnel lleva el tráfico de internet hasta ese puerto.

## Paso 1 — Instalar cloudflared

```bash
brew install cloudflared
cloudflared --version
```

## Paso 2 — Levantar el port-forward

El tunnel necesita que el port-forward esté activo:

```bash
./port-forward-orbstack.sh
```

Esto deja `api-gateway` disponible en `http://localhost:8080`. Verificar:

```bash
curl http://localhost:8080/health
```

## Paso 3 — Túnel rápido (temporal)

Para una prueba puntual sin configuración:

```bash
cloudflared tunnel --url http://localhost:8080
```

Devuelve una URL tipo `https://random-words.trycloudflare.com`. Cambia cada vez que se reinicia — hay que reconfigurar el webhook en Meta/Telegram cada vez. Solo sirve para pruebas puntuales.

## Paso 4 — Túnel con nombre fijo (recomendado)

Si vas a desarrollar seguido, conviene un túnel con URL fija.

### 4.1 — Login en Cloudflare (una sola vez)

```bash
cloudflared tunnel login
```

Se abre el browser. Guardar credenciales en `~/.cloudflared/cert.pem`.

### 4.2 — Crear el túnel (una sola vez)

```bash
cloudflared tunnel create yoizen-dev
```

Anota el **Tunnel ID** (UUID) de la salida. Crea `~/.cloudflared/<tunnel-id>.json`.

### 4.3 — Rutear DNS al túnel (una sola vez)

Necesitás un dominio en tu cuenta de Cloudflare:

```bash
cloudflared tunnel route dns yoizen-dev webhooks.tu-dominio.com
```

Cloudflare crea un CNAME automáticamente en tu zona DNS.

### 4.4 — Archivo de configuración

```bash
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: yoizen-dev
credentials-file: /Users/<tu-usuario>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: webhooks.tu-dominio.com
    service: http://localhost:8080
  - service: http_status:404
EOF
```

### 4.5 — Levantar el túnel

```bash
cloudflared tunnel run yoizen-dev
```

Verificar:

```bash
curl https://webhooks.tu-dominio.com/health
```

## Paso 5 — Configurar el webhook en Meta (WhatsApp/Instagram)

1. Meta Developer Dashboard → tu app → WhatsApp (o Instagram) → Configuration → Webhook
2. Completar:

```
Callback URL:  https://webhooks.tu-dominio.com/webhooks/whatsapp/acme
Verify token:  (el valor de verifyToken de tu cuenta — el que pusiste al crear la cuenta)
```

Para Instagram: reemplazar `whatsapp` por `instagram`.

3. Clic en "Verify and Save"
4. Suscribirse al campo **messages** (sin esto Meta no envía eventos)

## Configurar el webhook en Telegram

Telegram usa un token secreto en lugar de verify_token. Al registrar el webhook:

```bash
# Reemplazá TOKEN_BOT con el token del bot de Telegram
# Y SECRET con el valor de telegramBotToken de la cuenta
curl "https://api.telegram.org/bot<TOKEN_BOT>/setWebhook" \
  -d "url=https://webhooks.tu-dominio.com/webhooks/telegram/acme" \
  -d "secret_token=<SECRET>"
```

Verificar:

```bash
curl "https://api.telegram.org/bot<TOKEN_BOT>/getWebhookInfo"
```

## Checklist antes de probar

```
✓ port-forward-orbstack.sh corriendo
✓ cloudflared tunnel corriendo
✓ curl http://localhost:8080/health devuelve 200
✓ curl https://webhooks.tu-dominio.com/health devuelve 200
✓ Webhook verificado en Meta / registrado en Telegram
✓ Suscrito al campo "messages" en Meta
✓ Access token no expirado (temporales duran 24h)
✓ En sandbox de Meta: el número sender está en test recipients
```

## Troubleshooting

### "Verify and Save" falla en Meta

```
✓ Port-forward activo (kubectl logs o curl localhost:8080/health)
✓ Túnel activo (curl https://webhooks.tu-dominio.com/health)
✓ La URL termina en /webhooks/whatsapp/<tenantId>
✓ El verify token coincide EXACTAMENTE con el verifyToken de la cuenta
```

### No llegan mensajes después de verificar

```
✓ Suscrito al campo "messages" en Meta (el toggle)
✓ El access token no expiró
✓ En sandbox: el número que manda está en test recipients
```

### La firma del webhook falla (channel-service rechaza)

channel-service valida la firma HMAC SHA-256 (Meta) o el secret token (Telegram) al procesar el `WebhookIngressEnvelope`. Verificar que:

```
✓ appSecret en la cuenta coincide con App Secret de Meta Dashboard → Settings → Basic
✓ Para Telegram: telegramBotToken en la cuenta coincide con el token del bot
```

### cloudflared se desconecta

cloudflared reconecta automáticamente. Para sesiones largas:

```bash
tmux new -s tunnel
cloudflared tunnel run yoizen-dev
# Ctrl+B, D para detach
```
