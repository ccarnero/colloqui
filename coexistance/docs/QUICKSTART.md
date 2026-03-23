# Quickstart

## Requisitos

- Bun (runtime principal)
- MongoDB corriendo en localhost:27017
- kubectl (para port-forward de NATS desde k8s)
- cloudflared (tunnel para webhooks de Meta)

## Setup inicial

```bash
# Clonar y entrar al proyecto
cd coexistance

# Copiar .env si no existe
cp .env.example .env
# Editar .env con tus credenciales de Meta

# Instalar dependencias
bun install

# Seed: crea user + sandbox account (idempotente)
bun run seed
```

## Levantar el entorno completo

```bash
# Opción A: script automático (levanta todo en paralelo)
chmod +x docs/flujos/dev-start.sh
./docs/flujos/dev-start.sh

# Opción B: manual en terminales separadas

# Terminal 1 — NATS port-forward desde k8s
kubectl port-forward svc/nats 4222:4222 -n support-services-dev

# Terminal 2 — Tunnel para webhooks de Meta
cloudflared tunnel run --protocol http2 whatsapp-dev

# Terminal 3 — Backend (hot reload)
bun run dev

# Terminal 4 — Frontend (Vite HMR)
bun run dev:client
```

## Verificar

```bash
# Health check
curl -s http://localhost:6666/api/health

# Ver servicios activos en el log del server:
#   ingress, egress, persistence, sse, health, auto-reply
```

## Puertos

| Servicio | Puerto |
|----------|--------|
| Server (Express) | 6666 |
| Frontend (Vite) | 5173 (proxy → 6666) |
| NATS | 4222 (k8s port-forward) |
| MongoDB | 27017 |

## Login

```
email:    christian.carnero@gmail.com
password: coexistance2024
```

## Scripts útiles

```bash
bun run dev          # Server con hot reload
bun run dev:client   # Frontend con HMR
bun run test         # Vitest (150+ tests)
bun run seed         # Seed idempotente
bun run build        # Build del frontend → client/dist/
```

## Loop de desarrollo

- Cambios en `server/src/` → Bun recarga automáticamente
- Cambios en `client/src/` → Vite HMR actualiza el browser
- Cambios en dependencias → `bun install` + restart

## Más documentación

- [Arquitectura del bus NATS](./arquitectura/README.md)
- [Flujos con diagramas de secuencia](./flujos/README.md)
- [Guías de uso](./help/README.md)
- [PRD del MVP](./PRD.md)
