// SSE hook — connects to /api/events/stream via EventSource.
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
