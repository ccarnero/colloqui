# Etapa 9 — Frontend: migrar WebSocket → SSE

## Objetivo
Reemplazar el hook useWebSocket por useEventStream (SSE). El backend SSE ya está listo en GET /api/events/stream. Solo hay que cambiar el frontend.

## Contexto del flow actual

DEPRECATED — El frontend originalmente usaba `use-websocket.js` que:
1. Conectaba a `ws://host/ws`
2. Enviaba `{ type: 'auth', token }` como primer mensaje
3. Esperaba `{ type: 'auth_ok' }` de confirmación
4. Recibía eventos `{ type: 'new_message'|'status_update', data: {...} }`
5. Reconectaba automáticamente con setTimeout 3s

Ahora usa SSE via `use-event-stream.js`. El dashboard (`DashboardPage.jsx`) usa `useEventStream(handleSseEvent)` donde handleSseEvent:
- Filtra por account_id (ignora eventos de otras cuentas)
- Llama refreshConversations() y bumps refreshTick

## Archivos a modificar

### client/src/lib/use-event-stream.js (NUEVO — reemplaza use-websocket.js)

```javascript
// SSE hook — connects to /api/events/stream, receives events via EventSource.
// Simpler than WebSocket: no auth handshake, auto-reconnect built-in.
// Token goes in URL query param (EventSource doesn't support custom headers).

import { useEffect, useRef } from 'react'

const useEventStream = (onMessage) => {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    let stopped = false
    let sse = null
    let reconnectTimer = null

    const connect = () => {
      if (stopped) return

      const token = localStorage.getItem('coexistance_token')
      if (!token) return

      try {
        sse = new EventSource(`/api/events/stream?token=${token}`)

        sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            // 'connected' is the initial handshake — skip it
            if (data.type === 'connected') {
              console.log('  [SSE] Connected')
              return
            }
            onMessageRef.current?.(data)
          } catch {
            // ignore parse errors
          }
        }

        sse.onerror = () => {
          console.warn('  [SSE] Connection error — will reconnect')
          sse?.close()
          sse = null
          if (!stopped) {
            reconnectTimer = setTimeout(connect, 5000)
          }
        }
      } catch (e) {
        console.warn('  [SSE] Failed to connect:', e.message)
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 5000)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      clearTimeout(reconnectTimer)
      sse?.close()
    }
  }, [])
}

export { useEventStream }
```

### client/src/pages/DashboardPage.jsx

```
Cambios mínimos:

1. Cambiar import:
   ANTES: import { useWebSocket } from '../lib/use-websocket.js'
   AHORA: import { useEventStream } from '../lib/use-event-stream.js'

2. Cambiar la llamada al hook:
   ANTES: useWebSocket(handleWsMessage)
   AHORA: useEventStream(handleWsMessage)

3. Actualizar handleWsMessage para el formato SSE:
   El SSE bridge envía: { type: 'io.yoizen.messaging.ingress.received.v1', data: rawPayload, eventId, tenant }
   ANTES: event.type era 'new_message' o 'status_update' y event.data.account_id existía

   AHORA: el evento SSE tiene el envelope type y el raw payload de Meta en data.
   Necesitamos adaptar handleWsMessage:

   const handleSseEvent = useCallback((event) => {
     // SSE events come from NATS envelope — any messaging event triggers a refresh
     // The SSE bridge already filters by account (only sends events for user's accounts)
     // So we can safely refresh on any event
     console.log(`[sse] event: ${event.type} | eventId: ${event.eventId}`)
     refreshConversations()
     setRefreshTick((t) => t + 1)
   }, [refreshConversations])

   useEventStream(handleSseEvent)

   NOTA: la filtración por account_id ya no es necesaria en el frontend.
   El backend SSE bridge solo envía eventos de las cuentas del usuario autenticado.
   Esto simplifica el código — no más activeAccountIdRef ni comparación manual.

4. Limpiar: eliminar activeAccountIdRef y su useEffect (ya no necesario).
```

### client/vite.config.js

```
Agregar proxy para SSE:

proxy: {
  '/api': {
    target: 'http://localhost:6666',
    changeOrigin: true,
  },
  // /ws proxy se puede eliminar pero dejarlo no hace daño
},

NOTA: /api ya cubre /api/events/stream — no necesita proxy adicional.
Verificar que el proxy existente de /api funciona para SSE (debería, Vite soporta streaming).
```

## Archivos que ya NO se usan

- `client/src/lib/use-websocket.js` — NO ELIMINAR todavía, solo dejar de importar.
  Agregar un comentario al inicio: `// DEPRECATED — replaced by use-event-stream.js`

## Verificación

```bash
# Arrancar el server con NATS
cd server && bun src/server.js

# Arrancar el frontend
cd client && bun run dev

# Abrir http://localhost:5173 en el browser
# Login con credenciales existentes
# Abrir DevTools → Network → filtrar por "EventSource" o "stream"
# Debe verse la conexión SSE activa con heartbeats cada 30s

# Enviar un mensaje de prueba al webhook o usar el smoke test
# El dashboard debe actualizar la lista de conversaciones en tiempo real
```

## Test de regresión

El flow completo que debe funcionar:
1. Login → ver dashboard con conversaciones
2. Un mensaje entrante de Meta llega al webhook
3. Webhook publica a NATS
4. Persistence consumer guarda en MongoDB
5. SSE bridge envía evento al browser
6. Frontend recibe evento → refreshConversations → UI actualizada
7. Enviar mensaje desde el chat → API → Meta → saved in DB → aparece en la UI
