# Coexistance — Documentación

## Guías

| #  | Documento | Qué encontrás |
|----|-----------|----------------|
| 01 | [Primeros Pasos](01-primeros-pasos.md) | Setup, login, qué opción elegir al conectar, flujo general |
| 02 | [Meta Dashboard](02-meta-dashboard.md) | Dónde sacar WABA ID, Phone Number ID, Access Token y cada valor que pide la app |
| 03 | [Usar el Dashboard](03-usar-el-dashboard.md) | Cómo funciona la UI: conversaciones, chat, templates, WebSocket |
| 04 | [API Reference](04-api-reference.md) | Todos los endpoints con curl de ejemplo, WebSocket, códigos de error |
| 05 | [Arquitectura](05-arquitectura.md) | Estructura de archivos, principios de diseño, flujos de mensajes |
| 06 | [Cloudflare Tunnel](06-cloudflare-tunnel.md) | Exponer tu server local para recibir webhooks de Meta |
| 07 | [Troubleshooting v0](07-troubleshooting-v0.md) | Todos los problemas que resolvimos y cómo evitarlos |

## Respuestas rápidas

**¿Cómo arranco?**
→ `./setup.sh` y después `bun server/src/server.js`

**¿Qué credenciales uso para logueame?**
→ `christian.carnero@gmail.com` / `coexistance2024`

**¿Qué pongo en la pantalla de "Sandbox / Manual Connect"?**
→ Los IDs de tu app de Meta. Ver [02-meta-dashboard.md](02-meta-dashboard.md) para saber exactamente dónde encontrar cada uno.

**¿Puedo probar sin una cuenta real de WhatsApp Business?**
→ Sí. Con `LOCAL_TESTING=true` todo se mockea. Para probar con Meta pero sin número real, usá el test phone number del sandbox de Meta.

**¿Cómo configuro el webhook para recibir mensajes?**
→ Necesitás un túnel HTTPS. Ver [06-cloudflare-tunnel.md](06-cloudflare-tunnel.md) para el paso a paso completo.
→ Resumen: `cloudflared tunnel --url http://localhost:6666` → copiá la URL → pegala en Meta Dashboard → WhatsApp → Configuration → Webhook con `/api/webhooks/whatsapp` al final.

**¿Qué es BSUID?**
→ Business-Scoped User ID. A partir de junio 2026 algunos usuarios de WhatsApp tendrán un username en vez de teléfono. Coexistance lo soporta de fábrica.

**¿Cómo corro los tests?**
→ `cd server && npx vitest run`
