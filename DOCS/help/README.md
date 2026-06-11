# Ayuda — Yoizen Platform

Guías operacionales para desarrolladores y operadores.

Para la arquitectura canónica del sistema ver `DOCS/arquitectura/`.

## Guías

| # | Documento | Qué encontrás |
|---|-----------|----------------|
| 01 | [Primeros Pasos](01-primeros-pasos.md) | Bootstrap K8s, crear tenant, login, conectar canal |
| 02 | [Meta Dashboard](02-meta-dashboard.md) | Dónde obtener WABA ID, Phone Number ID, App Secret |
| 03 | [Usar el Dashboard](03-usar-el-dashboard.md) | admin-console, messaging-console, SSE, auto-reply |
| 04 | [API Reference](04-api-reference.md) | Todos los endpoints de api-gateway con ejemplos curl |
| 05 | [Arquitectura](05-arquitectura.md) | Resumen de servicios, infraestructura, subjects NATS |
| 06 | [Cloudflare Tunnel](06-cloudflare-tunnel.md) | Exponer el cluster local para recibir webhooks |

## Respuestas rápidas

**¿Cómo arranco?**
→ `./bootstrap-orbstack.sh` y después `./port-forward-orbstack.sh`

**¿Cómo creo un tenant?**
→ `./scripts/setup-tenant.sh <tenant-name>`

**¿Qué header uso para autenticarme?**
→ `Authorization: Bearer <token>` + `x-yoizen-tenant: <tenant-id>`

**¿Cómo obtengo un token?**
→ `POST /auth/login` con email + password, o `POST /auth/token` con client credentials

**¿Cómo configuro el webhook de Meta para desarrollo local?**
→ Necesitás un túnel HTTPS. Ver [06-cloudflare-tunnel.md](06-cloudflare-tunnel.md).
→ Resumen: `cloudflared tunnel --url http://localhost:8080` → URL → Meta Dashboard → `/webhooks/whatsapp/<tenantId>`

**¿Qué endpoint recibe los webhooks?**
→ `POST /webhooks/:channel/:tenantId` — público, sin JWT, tenant resuelto del path

**¿Cómo recibo eventos en tiempo real?**
→ `GET /channels/stream` — SSE con JWT en header

**¿Cuántos canales soporta?**
→ WhatsApp (Meta), Instagram (Meta), Telegram — ver [04-api-reference.md](04-api-reference.md)
