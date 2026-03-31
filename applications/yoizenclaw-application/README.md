# YoizenClaw

Python runtime for the Yoizen stack. The runtime starts in
`waiting_for_config` mode until the control plane syncs agent configuration
and runtime seed files.

## Tabla de Contenidos

- [Run Locally](#run-locally)
- [Runtime Contract](#runtime-contract)
- [Architecture](#architecture)
- [API Surface](#api-surface)
- [Observability](#observability)
- [Startup Behavior](#startup-behavior)
- [Testing](#testing)

## Run Locally

```bash
pip install -e .
cp .env.example .env
uvicorn src.interfaces.http.routes:app --reload --host 0.0.0.0 --port 8000
```

If you want the runtime plus its local PostgreSQL dependency, use the runtime
compose file from this directory:

```bash
docker compose up -d
```

## Observabilidad

YoizenClaw incluye observabilidad completa basada en OpenTelemetry:

- **Trazas Distribuidas**: W3C Trace Context propagation
- **Métricas**: Prometheus/OpenTelemetry metrics
- **Logs**: Estructurados con correlación de IDs
- **Dashboards**: Grafana pre-configurado

### Stack de Observabilidad

```bash
# Iniciar stack completo
docker-compose -f docker-compose.observability.yml up -d

# Acceder a dashboards
open http://localhost:3000  # Grafana
```

### Variables de Telemetría

```bash
# Habilitar telemetría
OTEL_ENABLED=true
OTEL_SERVICE_NAME=yoizen-claw
OTEL_ENDPOINT=http://otel-collector:4317
OTEL_SAMPLING_RATE=1.0  # 1.0 en dev, 0.1 en prod
```

### Documentación Completa

- [Guía de Observabilidad](./OBSERVABILITY.md) - Arquitectura y configuración
- [Troubleshooting](./observability/TROUBLESHOOTING.md) - Solución de problemas
- [Dashboards](./observability/grafana/README.md) - Documentación de dashboards

## Runtime Contract

The runtime reads configuration from environment variables and from the
backend-synced runtime config directory.

Environment variables used directly by the runtime:

- `BACKEND_WS_URL`
- `RUNTIME_API_KEY`
- `BACKEND_HTTP_URL`
- `BACKEND_HTTP_API_KEY`
- `RUNTIME_CONFIG_DIR`
- `DATABASE_URL`
- `CORS_ORIGINS`

Provider secrets are expected to arrive through control-plane-managed
credential profiles and runtime config sync, not from hardcoded values.

The `BACKEND_*` names are legacy bootstrap variables kept for compatibility;
in the current compose stack they point at the API gateway.

Legacy aliases such as `YOIZEN_API_URL`, `YOIZEN_API_KEY`, and
`YOIZEN_RUNTIME_CONFIG_DIR` are still accepted by the code for migration
periods, but they are no longer part of the recommended runtime contract.

The runtime expects PostgreSQL with pgvector enabled. The memory backend
initializes the `vector` extension on startup.

## Architecture

The preferred implementation paths are:

```text
src/
|-- application/   # Use cases and orchestration
|-- config_loader/ # Runtime configuration and seed loaders
|-- domain/        # Pure entities and domain rules
|-- infrastructure/# External adapters and persistence
|-- interfaces/    # HTTP and websocket adapters
|-- jobs/          # Scheduler, triggers, and job execution
|-- shared/        # Shared helpers and logging
\-- core/          # Compatibility layer for legacy imports
```

The runtime keeps a few compatibility modules under `src/core` and `src/api`
so older imports continue to work while the newer interfaces stay in place.

## API Surface

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | Returns `waiting_for_config` until the runtime is configured |
| GET | `/logs` | Application logs, filterable by level |
| GET | `/logs/access` | HTTP access logs, filterable by level |
| POST | `/config/sync` | Applies an agent configuration payload from the backend |
| POST | `/config/files/sync` | Writes backend-managed seed files into the runtime config dir |
| POST | `/chat/respond` | Generates a runtime chat response |
| GET | `/jobs` | Lists configured jobs |
| POST | `/jobs` | Creates a job |
| PUT | `/jobs/{job_id}` | Updates a job |
| DELETE | `/jobs/{job_id}` | Deletes a job |
| POST | `/jobs/{job_id}/trigger` | Triggers a job manually |

## Startup Behavior

On startup the runtime:

1. Initializes structured JSON logging.
2. Loads runtime memory and agent configuration.
3. Starts the job scheduler.
4. Opens the websocket connection back to the control plane.

That means the health endpoint is reachable before full configuration, but it
only reports `configured: true` after the control plane has synced runtime
data.

## Testing

```bash
pytest
```

The test suite covers memory, configuration loading, websocket behavior, and
job orchestration.
