# Primeros Pasos — Yoizen Platform

## Qué es

Yoizen Platform es una plataforma multi-tenant para gestionar atención al cliente por WhatsApp, Instagram y Telegram. Cada tenant tiene aislamiento total de datos y puede conectar múltiples cuentas de canal.

## Flujo general

```
Bootstrap K8s → Crear tenant → Login → Conectar cuenta de canal → Recibir/Enviar mensajes
```

## 1. Pre-requisitos

- OrbStack (macOS) o minikube para el cluster local
- `kubectl`, `helm`, `kustomize` disponibles en PATH
- Docker con imágenes de los servicios buildeadas localmente

## 2. Bootstrap del cluster

```bash
# OrbStack (recomendado en macOS):
./bootstrap-orbstack.sh

# Minikube:
./bootstrap-minikube.sh
```

El bootstrap instala Knative, NATS, Redis, y despliega todos los servicios de plataforma.

## 3. Levantar port-forwards

Para acceder a la plataforma desde localhost:

```bash
./port-forward-orbstack.sh
```

Esto expone `api-gateway` en `http://localhost:8080` (por defecto). La URL directa en dev con OrbStack es `http://api-gateway.platform-services-dev.dev.local`.

## 4. Crear un tenant y usuario admin

Usa el script de conveniencia:

```bash
./setup-tenant.sh --tenant-id <tenant-id>
# o, con argumentos posicionales:
./scripts/provision-tenant.sh <tenant-id>
```

Esto llama a `POST /tenants` para crear el tenant (namespace K8s + Postgres dedicado), y luego registra un usuario admin en `auth-service`. `setup-tenant.sh` (raíz del repo) acepta flags con nombre e incluye chequeos de idempotencia; `scripts/provision-tenant.sh` usa argumentos posicionales.

Para hacerlo manualmente:

```bash
# Crear tenant
curl -X POST http://localhost:8080/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -d '{ "name": "acme" }'

# Crear usuario admin del tenant
curl -X POST http://localhost:8080/auth/tenant-users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "x-yoizen-tenant: acme" \
  -d '{ "email": "admin@acme.com", "password": "...", "role": "admin" }'
```

## 5. Login

```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -H "x-yoizen-tenant: acme" \
  -d '{ "email": "admin@acme.com", "password": "..." }'
```

Respuesta: `{ "access_token": "eyJ...", "token_type": "Bearer", ... }`

## 6. Conectar una cuenta de canal (WhatsApp)

```bash
curl -X POST http://localhost:8080/channels/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "whatsapp",
    "name": "Mi negocio",
    "phoneNumberId": "987654321",
    "wabaId": "123456789",
    "accessToken": "EAAYBvy...",
    "appSecret": "...",
    "verifyToken": "mi_verify_token"
  }'
```

Los IDs se obtienen del Meta Developer Dashboard — ver [02-meta-dashboard.md](./02-meta-dashboard.md).

## 7. Configurar el webhook en Meta

Una vez conectada la cuenta, configurá el webhook URL en el Meta Developer Dashboard:

```
URL:          https://tu-dominio.com/webhooks/whatsapp/acme
Verify Token: (el valor de verifyToken que usaste al crear la cuenta)
Fields:       messages
```

Para desarrollo local con túnel: ver [06-cloudflare-tunnel.md](./06-cloudflare-tunnel.md).

## ¿Y ahora?

- Recibir mensajes: ver [DOCS/es/flujos/01-recibir-mensaje.md](../flujos/01-recibir-mensaje.md)
- API completa: ver [04-api-reference.md](./04-api-reference.md)
- Arquitectura: ver [05-arquitectura.md](./05-arquitectura.md)
