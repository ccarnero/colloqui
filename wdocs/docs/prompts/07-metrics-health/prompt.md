# Etapa 7 — Métricas básicas y health endpoint

## Objetivo
Agregar observabilidad mínima: contadores, histogramas simples, y un health endpoint que muestre el estado del bus.

## Archivos a crear

### server/src/bus/metrics.js

```
Implementa createBusMetrics() → objeto con funciones para registrar métricas.

NO usar prom-client ni librerías externas. Approach minimal consistente con el estilo del proyecto.

Internamente usa un Map para contadores y arrays para histogramas.

Funciones expuestas:
- increment(name, tags) — incrementa un counter
  tags es un objeto plano { tenant, channel, provider }
  La key interna es: `${name}|${JSON.stringify(tags)}` para diferenciar por dimensión

- observe(name, value, tags) — agrega un valor a un histograma (array de valores)

- snapshot() — retorna el estado actual de todas las métricas
  Formato:
  {
    counters: { "ingress.received|{...}": 5, ... },
    histograms: {
      "ingress.publish_latency_ms|{...}": {
        count: 10,
        min: 2,
        max: 45,
        avg: 12.5,
        p95: 40,     // percentil 95
      }
    }
  }

- reset() — limpia todo (para tests)

export { createBusMetrics }
```

### server/src/routes/bus-health-routes.js

```
Implementa registerBusHealthRoutes(app, nc, busMetrics, sseBridge) → void

GET /api/bus/health
  Retorna:
  {
    status: 'ok',
    nats: nc ? 'connected' : 'disconnected',
    sse_clients: sseBridge ? sseBridge.getClientCount() : 0,
    metrics: busMetrics ? busMetrics.snapshot() : null,
    timestamp: new Date().toISOString(),
  }

GET /api/bus/metrics
  Retorna solo busMetrics.snapshot() (para scraping o dashboards)

export { registerBusHealthRoutes }
```

## Archivos a modificar

### server/src/bus/process-ingress.js

```
Agregar metrics al config:
config: { nc, producer, metrics }

Registrar métricas en el pipeline:

Al inicio:
  if (config.metrics) config.metrics.increment('ingress.received', { tenant, channel: 'whatsapp', provider: 'meta' })

Si publish ok:
  if (config.metrics) {
    config.metrics.increment('ingress.published', { tenant, channel: 'whatsapp', provider: 'meta' })
    config.metrics.observe('ingress.publish_latency_ms', Date.now() - startTime, { tenant })
    config.metrics.observe('ingress.payload_bytes', envelope.data.payload_bytes, { tenant })
  }

Si publish falla:
  if (config.metrics) config.metrics.increment('ingress.publish_failed', { tenant, channel: 'whatsapp', provider: 'meta' })

NOTA: metrics es opcional — si no se pasa, el pipeline funciona igual (para tests y backward compat).
```

### server/src/server.js

```
Agregar:

import { createBusMetrics } from './bus/metrics.js'
import { registerBusHealthRoutes } from './routes/bus-health-routes.js'

// After NATS setup:
const busMetrics = nc ? createBusMetrics() : null

// Pasar metrics via busConfig (el objeto ya se pasa desde etapa 3):
// ANTES:  registerWebhookRoutes(app, db, env, { nc })
// AHORA:  registerWebhookRoutes(app, db, env, { nc, metrics: busMetrics })

// Register health routes:
registerBusHealthRoutes(app, nc, busMetrics, sseBridge)

// Startup log update:
  metrics: busMetrics ? '/api/bus/health' : 'disabled'
```

## Tests a crear

```
server/tests/bus/metrics.test.js
server/tests/routes/bus-health-routes.test.js
```

- **metrics**: increment, observe, snapshot format, p95 calculation, reset clears all
- **bus-health-routes**: verificar JSON de health, verificar metrics endpoint, verificar con NATS disconnected

## Verificación

```bash
bun test server/tests/bus/metrics.test.js
bun test server/tests/routes/bus-health-routes.test.js
```

Test manual:
```bash
# Arrancar server con NATS
bun src/server.js

# Health check
curl http://localhost:3000/api/bus/health | jq .

# Enviar algunos webhooks de prueba, luego:
curl http://localhost:3000/api/bus/metrics | jq .
# Debe mostrar counters > 0 y histogramas con estadísticas
```
