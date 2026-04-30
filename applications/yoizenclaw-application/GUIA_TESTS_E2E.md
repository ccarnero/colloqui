# Guía: Ejecutar y Analizar Tests E2E de YoizenClaw

## Objetivo

Ejecutar los tests end-to-end del proyecto YoizenClaw como **tests pytest reales** con assertions, fixtures compartidos, y validación del sistema en vivo.

## Estructura de Tests

```
applications/yoizenclaw-application/
├── e2e/                                  # Tests end-to-end (pytest)
│   ├── conftest.py                       # Fixtures compartidos (NATS, HTTP, seed)
│   ├── helpers/                          # Módulos reutilizables
│   │   ├── config.py                     # E2EConfig (env-based)
│   │   ├── nats_client.py               # NatsTestClient (connect, request/reply)
│   │   ├── http_client.py               # HttpTestClient (health, endpoints)
│   │   ├── assertions.py                # assert_reply_success, assert_chat_response_content, etc.
│   │   └── factories.py                 # make_session_id, build_multiturn_scenario, etc.
│   ├── test_multiturn_session.py         # Conversaciones multiturno con sesión
│   ├── test_multiturn_avanzado.py        # Tests avanzados: typos, memoria, aislamiento
│   ├── test_sales_assistant.py           # Tests de asistente de ventas
│   ├── test_playground_agent.py          # Tests de agentes playground/draft
│   ├── test_system_integration.py         # Tests de integración completa
│   ├── tests_e2e_avanzado.py             # Health, métricas, multiturno, concurrencia
│   ├── tests_e2e_completo.py             # Smoke tests de endpoints HTTP
│   └── tests_e2e_seguridad.py            # Seguridad: auth, inyección, aislamiento
├── tests/                                # Tests unitarios/integración
└── pyproject.toml                        # Config pytest (testpaths, markers)
```

## Pre-requisitos

1. **Docker y Docker Compose** instalados
2. **NATS** corriendo en `localhost:4222`
3. **PostgreSQL** corriendo (para persistencia de agentes)
4. **YoizenClaw app** corriendo en Docker
5. **Dependencias Python**: `pytest`, `pytest-asyncio`, `nats-py`, `httpx`

### Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `NATS_URL` | `nats://localhost:4222` | URL del servidor NATS |
| `YOIZENCLAW_URL` | `http://localhost:8080` | URL de la app YoizenClaw |
| `RUNTIME_API_KEY` | (vacío) | API key para endpoints protegidos |
| `TENANT_ID` | `test-tenant` | Tenant ID para subjects NATS |
| `E2E_CHAT_TIMEOUT` | `30` | Timeout en segundos para chat replies |
| `E2E_HEALTH_TIMEOUT` | `10` | Timeout para health checks |

## Comandos para Ejecutar

### 1. Iniciar Infraestructura

```bash
cd applications/yoizenclaw-application

# Detener y limpiar todo
docker-compose down

# Iniciar servicios (NATS, PostgreSQL, YoizenClaw)
docker-compose up --build -d

# Esperar a que todo esté listo (30-60 segundos)
sleep 45
```

### 2. Ejecutar Tests E2E

```bash
# Todos los tests E2E
python3 -m pytest e2e/ -v

# Solo tests de sesión multiturno
python3 -m pytest e2e/test_multiturn_session.py -v

# Solo tests de seguridad
python3 -m pytest e2e/ -m security -v

# Solo tests de ventas
python3 -m pytest e2e/test_sales_assistant.py -v

# Solo smoke tests HTTP
python3 -m pytest e2e/tests_e2e_completo.py -v

# Ver output detallado con prints
python3 -m pytest e2e/ -v -s

# Parar en primer failure
python3 -m pytest e2e/ -v -x
```

### 3. Ver discovery (sin ejecutar)

```bash
python3 -m pytest e2e/ --collect-only
```

## Cómo Funciona la Suite

### Agentes Semilla (Seed)

Los tests **no usan agentes hardcodeados**. Antes de ejecutarse, el fixture `_seed_test_agents` registra 4 agentes vía `config_sync` NATS:

| Agent ID | Uso |
|----------|-----|
| `e2e-test-agent` | Tests generales, Q&A, multiturno |
| `e2e-medical-agent` | Tests médicos, typos |
| `e2e-engineering-agent` | Tests de ingeniería, memoria |
| `e2e-sales-agent` | Tests de ventas |

Esto asegura que el runtime pueda resolver los agentes desde `agent_runtime_overrides`.

### Ciclo de Vida

```
Session start
  → http_client conecta (session-scoped)
  → healthy_service verifica que la app responda (skip si no)
  → nats_client conecta (session-scoped, depende de healthy)
  → _seed_test_agents registra 4 agentes via config_sync (session-scoped, autouse)
  → Tests se ejecutan con assertions reales
  → _cleanup_test_agents elimina agentes al final
  → Clientes se cierran en teardown
```

### Assertions Disponibles

| Assertion | Qué valida |
|-----------|------------|
| `assert_reply_received(reply)` | Reply no es None y es dict |
| `assert_reply_success(reply)` | kind="reply" y success=True |
| `assert_reply_error(reply)` | Reply es error (kind="error" o success=False) |
| `assert_chat_response_fields(data)` | Tiene los 6 campos requeridos |
| `assert_chat_response_content(reply, expected_keywords)` | Contiene keywords en la respuesta |
| `assert_health_ok(resp_json)` | Health responde ok/degraded con dependencies |
| `assert_cloud_event_valid(envelope)` | CloudEvent tiene todos los campos requeridos |
| `assert_session_isolation(a, b)` | Dos sesiones son diferentes |

### Marcadores pytest

| Marker | Uso |
|--------|-----|
| `@pytest.mark.e2e` | Todos los tests E2E |
| `@pytest.mark.security` | Tests de seguridad |
| `@pytest.mark.slow` | Tests lentos |

## Formato de Mensajes

### Request (CloudEvents envelope)

```json
{
  "specversion": "1.0",
  "id": "uuid",
  "source": "/services/yoizenclaw/agents/e2e-test-agent",
  "type": "io.yoizen.yoizenclaw.agent.agent_outbound.v1",
  "resource": "tenant/test-tenant/agents/e2e-test-agent",
  "time": "2026-04-03T...",
  "traceid": "uuid",
  "tenant": "test-tenant",
  "accountid": "system",
  "idempotencykey": "sha256:...",
  "transport": {
    "method": "agent",
    "protocol": "internal",
    "agent_id": "e2e-test-agent",
    "depth": 0
  },
  "data": {
    "chat_id": "e2e-chat-uuid",
    "agent_id": "e2e-test-agent",
    "message": "Hola",
    "turn_number": 1,
    "session_id": "e2e-session-uuid",
    "timestamp": "2026-04-03T..."
  }
}
```

### Response (legacy envelope)

```json
{
  "kind": "reply",
  "success": true,
  "data": {
    "chat_id": "...",
    "agent_id": "e2e-test-agent",
    "response": "Mensaje generado por el agente",
    "turn_number": 1,
    "session_id": "...",
    "timestamp": "..."
  }
}
```

## Solución de Problemas

### Tests se skipean con "YoizenClaw service not healthy"

1. Verificar que Docker está corriendo: `docker ps`
2. Verificar health: `curl http://localhost:8080/health`
3. Revisar logs: `docker logs yoizenclaw-app`
4. Aumentar timeout: `E2E_HEALTH_TIMEOUT=60 pytest e2e/ -v`

### Tests fallan con "No reply received"

1. Verificar NATS: `docker logs yoizenclaw-app | grep "NATS bridge started"`
2. Verificar que los agentes se sembraron: los logs deberían mostrar config_sync
3. Verificar LLM: `docker logs yoizenclaw-app | grep -i "llm\|model\|provider"`
4. Aumentar timeout: `E2E_CHAT_TIMEOUT=60 pytest e2e/ -v`

### Tests de seguridad fallan con "Expected error for non-existent agent"

Esto es correcto si el agente `nonexistent-agent-99999` no existe. El test verifica que el sistema devuelva error en vez de crashear.

### ImportError en helpers

Asegurate de ejecutar desde el directorio raíz del proyecto:

```bash
cd applications/yoizenclaw-application
python3 -m pytest e2e/ -v
```

## Agregar Nuevos Tests

1. Crear archivo `e2e/test_mi_nuevo_test.py`
2. Usar los fixtures `nats_client` y/o `http_client` (inyectados automáticamente)
3. Usar `AGENT_ID = "e2e-test-agent"` (ya sembrado) o agregar nuevo ID a `conftest.py:E2E_AGENT_IDS`
4. Importar assertions de `e2e.helpers.assertions`
5. Importar factories de `e2e.helpers.factories`
6. Agregar `pytestmark = pytest.mark.e2e`

Ejemplo mínimo:

```python
"""E2E: Mi nuevo test."""
from __future__ import annotations
import pytest
from e2e.helpers.nats_client import NatsTestClient, parse_reply
from e2e.helpers.assertions import assert_reply_success
from e2e.helpers.factories import make_session_id, build_multiturn_scenario

pytestmark = pytest.mark.e2e
AGENT_ID = "e2e-test-agent"

class TestMiFeature:
    async def test_mi_escenario(self, nats_client: NatsTestClient):
        session_id = make_session_id()
        turns = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_id,
            messages=["Hola, test"],
        )
        subject = nats_client.build_subject("agent_outbound")
        envelope = nats_client.build_cloud_event(
            agent_id=AGENT_ID,
            action="agent_outbound",
            payload=turns[0],
        )
        raw = await nats_client.request_reply(subject, envelope)
        reply = parse_reply(raw)
        assert reply is not None
        assert_reply_success(reply)
```
