# YoizenClaw Runtime - Helm Chart

Helm chart para desplegar el runtime de YoizenClaw por tenant usando Knative Serving.

## Instalación

```bash
# Para tenant "acme" en ambiente dev
helm install yoizenclaw-acme ./yoizenclaw-runtime \
  --set tenantId=acme \
  --set environment=dev \
  --set postgres.passwordSecretName=postgres-acme-secret \
  --set image.tag=v1.0.0
```

## Requisitos

- Kubernetes cluster con Knative Serving instalado
- NATS JetStream con cuentas por tenant configuradas
- PostgreSQL per-tenant provisionado por Tenant Service
- Secret con credenciales PostgreSQL

## Configuración

| Parámetro | Descripción | Default |
|-----------|-------------|---------|
| `tenantId` | ID del tenant (requerido) | - |
| `environment` | Ambiente (dev, qa, staging, prod) | `dev` |
| `image.repository` | Repositorio de imagen | `dev.local/yoizenclaw-runtime` |
| `image.tag` | Tag de imagen | `latest` |
| `nats.url` | URL del servidor NATS | `nats://nats.default.svc.cluster.local:4222` |
| `postgres.passwordSecretName` | Secret con POSTGRES_PASSWORD | - |
| `knative.minScale` | Mínimo de pods (0 para serverless) | `0` |
| `knative.maxScale` | Máximo de pods | `3` |

## Arquitectura

Cada instancia del runtime:
- Se despliega en el namespace del tenant: `{tenantId}-{env}-ns`
- Conecta a PostgreSQL: `postgres.{tenantId}-{env}-ns.svc.cluster.local`
- Usa NATS Account propio con ACLs restrictivos
- Escala de 0 a N según tráfico (Knative)
- Incluye observabilidad OTEL integrada

## wdocs Compliance

- **NATS Subjects**: `evt.{tenant}.yoizenclaw.{action}.v1`
- **CloudEvents**: Envelope con transport.protocol="internal"
- **Claim Check**: Threshold 256KB, Object Store `PAYLOAD-{tenant}`
- **Depth Tracking**: MAX_DEPTH=5, anti-loop protection
- **PII Policy**: data.payload nunca en logs

## Comandos útiles

```bash
# Verificar template
helm template yoizenclaw-acme ./yoizenclaw-runtime --set tenantId=acme

# Actualizar release
helm upgrade yoizenclaw-acme ./yoizenclaw-runtime

# Desinstalar
helm uninstall yoizenclaw-acme
```
