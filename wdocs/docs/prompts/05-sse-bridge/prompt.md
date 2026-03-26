# Etapa 5 — SSE Bridge: reemplaza WebSocket

## Objetivo
Crear un consumer NATS que bridgea eventos al browser via Server-Sent Events (SSE). Luego eliminar el módulo WebSocket completo.

## Concepto clave

SSE es como una radio FM: el servidor transmite y el browser solo escucha. No necesitás un canal bidireccional (WebSocket) porque el dashboard solo necesita recibir eventos en tiempo real, no enviar. Para enviar mensajes el frontend ya usa las rutas REST normales.

## Archivos a crear

### server/src/bus/consumers/sse-bridge.js

```
Implementa createSseBridge(nc) → { registerClient, removeClient, getClientCount }

La función:
1. Se suscribe a 'evt.*.coexistance.messaging.>' usando subscribeToSubject (import de '../subscribe.js')
2. Mantiene un Map interno: accountId → Set<Response> (los response objects de SSE)
3. Cuando llega un evento NATS:
   a. Extrae envelope.accountid
   b. Busca en el Map todos los SSE clients suscritos a ese account
   c. Envía el evento a cada client: res.write(`data: ${JSON.stringify(ssePayload)}\n\n`)
   d. ssePayload = { type: envelope.type, data: envelope.data.payload, eventId: envelope.id, tenant: envelope.tenant }
4. Log: console.log(`  [SSE] Broadcasting ${envelope.id} to ${count} client(s) for account ${accountid}`)

Funciones expuestas:
- registerClient(accountId, res) → agrega el res al Set del account
- removeClient(accountId, res) → elimina el res del Set
- getClientCount() → total de clients conectados (para health)

import { subscribeToSubject } from '../subscribe.js'
import { StringCodec } from 'nats'
```

### server/src/routes/sse-routes.js

```
Implementa registerSseRoutes(app, db, env, sseBridge) → void

Ruta: GET /api/events/stream

El handler:
1. Verifica JWT del query param: ?token=xxx (porque EventSource no soporta headers custom)
   import { verifyToken } from '../auth/verify-token.js'
   const tokenResult = verifyToken(req.query.token, env.JWT_SECRET)
   Si falla → 401
2. Busca el user y sus account_ids
3. Setea headers SSE:
   res.writeHead(200, {
     'Content-Type': 'text/event-stream',
     'Cache-Control': 'no-cache',
     'Connection': 'keep-alive',
   })
4. Flush inicial: res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
5. Registra el client para cada accountId:
   accountIds.forEach(id => sseBridge.registerClient(id, res))
6. Heartbeat cada 30s: const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000)
7. On close:
   clearInterval(heartbeat)
   accountIds.forEach(id => sseBridge.removeClient(id, res))
   console.log(`  [SSE] Client disconnected — user: ${userId}`)

Log: console.log(`  [SSE] Client connected — user: ${userId}, accounts: [${accountIds}]`)

export { registerSseRoutes }
```

## Archivos a modificar

### server/src/server.js

```
Cambios:

1. Agregar imports:
   import { createSseBridge } from './bus/consumers/sse-bridge.js'
   import { registerSseRoutes } from './routes/sse-routes.js'

2. Después de suscribir el persistence consumer, crear el SSE bridge:
   let sseBridge = null
   if (nc) {
     sseBridge = createSseBridge(nc)
     console.log('  [SSE] Bridge started')
   }

3. Registrar la ruta SSE:
   registerSseRoutes(app, db, env, sseBridge)

4. ELIMINAR las siguientes líneas:
   - import { createWsServer } from './ws/create-ws-server.js'
   - const { broadcast } = createWsServer(httpServer, db, env)
   - La línea ws: del log de startup

5. Actualizar el log de startup:
   ANTES:  ws:   ws://localhost:${env.PORT}/ws
   AHORA:  sse:  /api/events/stream
           nats: ${nc ? env.NATS_URL : 'not connected'}

6. NOTA: el archivo ws/create-ws-server.js queda en el repo por referencia histórica, no se usa.
   Solo se eliminó el import y uso en server.js.
```

## Frontend — cambios necesarios (referencia)

```
NOTA PARA EL FRONTEND (no implementar ahora, solo documentar):

Reemplazar el WebSocket client por EventSource:

ANTES:
  const ws = new WebSocket(`ws://localhost:3000/ws`)
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }))
  ws.onmessage = (e) => handleEvent(JSON.parse(e.data))

AHORA:
  const sse = new EventSource(`/api/events/stream?token=${token}`)
  sse.onmessage = (e) => handleEvent(JSON.parse(e.data))
  sse.onerror = () => setTimeout(() => reconnect(), 5000)

EventSource reconecta automáticamente. No hay auth handshake — el token va en la URL.
Más simple que WebSocket para el caso de uso unidireccional.
```

## Tests a crear

```
server/tests/bus/consumers/sse-bridge.test.js
server/tests/routes/sse-routes.test.js
```

- **sse-bridge**: verificar que registerClient agrega al Map, removeClient elimina, un evento NATS llega a los clients registrados, un evento para un account sin clients no crashea
- **sse-routes**: mockear req/res/sseBridge, verificar headers SSE, verificar 401 con token inválido, verificar que on close limpia el client

## Verificación

```bash
bun test server/tests/bus/consumers/
bun test server/tests/routes/sse-routes.test.js
```

Test manual:
```bash
# Terminal 1: arrancar server
bun src/server.js

# Terminal 2: conectar SSE con curl
curl -N "http://localhost:3000/api/events/stream?token=TU_JWT_AQUI"
# Debe ver: data: {"type":"connected"}
# Y heartbeats cada 30s: : heartbeat

# Terminal 3: enviar webhook de prueba
# El evento debe aparecer en el curl del terminal 2
```
