// WebSocket hook — connects to /ws, authenticates with JWT,
// and calls onMessage for each incoming event.
// Auto-reconnects on disconnect.
//
// Uses same host as the page — Vite proxies /ws in dev, same server in prod.

import { useEffect, useRef } from 'react'

const getWsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

const useWebSocket = (onMessage) => {
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const onMessageRef = useRef(onMessage)

  // Keep callback ref fresh without triggering reconnects
  onMessageRef.current = onMessage

  useEffect(() => {
    let stopped = false

    const connect = () => {
      if (stopped) return

      const token = localStorage.getItem('coexistance_token')
      if (!token) return

      try {
        const ws = new WebSocket(getWsUrl())
        wsRef.current = ws

        ws.onopen = () => {
          console.log('  [WS] Connected')
          ws.send(JSON.stringify({ type: 'auth', token }))
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'auth_ok') {
              console.log('  [WS] Authenticated')
              return
            }
            onMessageRef.current?.(data)
          } catch {
            // ignore parse errors
          }
        }

        ws.onclose = () => {
          wsRef.current = null
          if (!stopped) {
            reconnectTimer.current = setTimeout(connect, 3000)
          }
        }

        ws.onerror = () => {
          // onclose fires after this — handles reconnect
        }
      } catch (e) {
        console.warn('  [WS] Connection failed:', e.message)
        if (!stopped) {
          reconnectTimer.current = setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [])
}

export { useWebSocket }
