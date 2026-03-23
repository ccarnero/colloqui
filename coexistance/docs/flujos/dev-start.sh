#!/usr/bin/env bash
# ==============================================================================
# dev-start.sh — Levanta todo el entorno local de Coexistance
#
# Dependencias del host:
#   - kubectl (configurado con el cluster donde corre NATS)
#   - cloudflared (tunnel configurado: whatsapp-dev)
#   - bun (runtime)
#   - mongod corriendo en el host de k8s (localhost:27017)
#
# Uso:
#   chmod +x dev-start.sh && ./dev-start.sh
#
# Para apagar todo:
#   ./dev-start.sh stop
# ==============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
NATS_LOCAL_PORT=4222
NATS_K8S_PORT=4222
NATS_K8S_SVC="svc/nats"           # ajustar si el service tiene otro nombre
NATS_K8S_NS="support-services-dev"              # ajustar al namespace real
PIDFILE="/tmp/coexistance-dev.pids"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}  [OK]${NC} $1"; }
warn() { echo -e "${YELLOW}  [!!]${NC} $1"; }
err()  { echo -e "${RED}  [ERR]${NC} $1"; }

# ── Stop mode ─────────────────────────────────────────────────────────────────
stop_all() {
  echo ""
  echo "  Apagando servicios..."
  if [[ -f "$PIDFILE" ]]; then
    while IFS= read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo "  killed PID $pid"
      fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  # Limpiar port-forwards huérfanos
  pkill -f "kubectl port-forward.*${NATS_LOCAL_PORT}" 2>/dev/null || true
  pkill -f "cloudflared tunnel run.*whatsapp-dev" 2>/dev/null || true
  log "Todo apagado."
  exit 0
}

[[ "${1:-}" == "stop" ]] && stop_all

# ── Preflight checks ─────────────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   Coexistance — Dev Environment Start    ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

command -v kubectl    >/dev/null 2>&1 || { err "kubectl no encontrado"; exit 1; }
command -v cloudflared >/dev/null 2>&1 || { err "cloudflared no encontrado"; exit 1; }
command -v bun        >/dev/null 2>&1 || { err "bun no encontrado"; exit 1; }

# Check .env exists
[[ -f "$PROJECT_DIR/.env" ]] || { err "No se encontró .env en $PROJECT_DIR"; exit 1; }

# Reset pidfile
> "$PIDFILE"

# ── 1. Port-forward NATS from k8s ────────────────────────────────────────────
echo "  [1/5] NATS port-forward (k8s → localhost:${NATS_LOCAL_PORT})"

# Kill any existing port-forward on that port
pkill -f "kubectl port-forward.*${NATS_LOCAL_PORT}" 2>/dev/null || true
sleep 1

kubectl port-forward \
  "${NATS_K8S_SVC}" \
  "${NATS_LOCAL_PORT}:${NATS_K8S_PORT}" \
  -n "${NATS_K8S_NS}" \
  > /tmp/coex-nats-pf.log 2>&1 &

NATS_PF_PID=$!
echo "$NATS_PF_PID" >> "$PIDFILE"

# Wait for port to be ready
for i in {1..10}; do
  if nc -z localhost "${NATS_LOCAL_PORT}" 2>/dev/null; then
    log "NATS accesible en localhost:${NATS_LOCAL_PORT} (PID: $NATS_PF_PID)"
    break
  fi
  [[ $i -eq 10 ]] && { warn "NATS port-forward tardó en abrir — revisa /tmp/coex-nats-pf.log"; }
  sleep 1
done

# ── 2. Verificar MongoDB ─────────────────────────────────────────────────────
echo "  [2/5] Verificando MongoDB (localhost:27017)"

if nc -z localhost 27017 2>/dev/null; then
  log "MongoDB respondiendo en localhost:27017"
else
  warn "MongoDB no responde en localhost:27017"
  warn "Si corre en el host de k8s, asegurate de que sea accesible."
  warn "Continuando de todos modos..."
fi

# ── 3. Cloudflared tunnel ────────────────────────────────────────────────────
echo "  [3/5] Cloudflare tunnel (whatsapp-dev)"

# Kill existing tunnel
pkill -f "cloudflared tunnel run.*whatsapp-dev" 2>/dev/null || true
sleep 1

cloudflared tunnel run --protocol http2 whatsapp-dev \
  > /tmp/coex-tunnel.log 2>&1 &

TUNNEL_PID=$!
echo "$TUNNEL_PID" >> "$PIDFILE"
sleep 2

if kill -0 "$TUNNEL_PID" 2>/dev/null; then
  log "Tunnel cloudflared corriendo (PID: $TUNNEL_PID)"
  log "Meta webhooks llegarán via el tunnel → localhost:6666"
else
  err "Tunnel cloudflared falló — revisa /tmp/coex-tunnel.log"
fi

# ── 4. Backend (bun --watch) ─────────────────────────────────────────────────
echo "  [4/5] Server Express + NATS services (bun --watch)"

cd "$PROJECT_DIR/server"

bun --watch src/server.js > /tmp/coex-server.log 2>&1 &

SERVER_PID=$!
echo "$SERVER_PID" >> "$PIDFILE"
sleep 2

if kill -0 "$SERVER_PID" 2>/dev/null; then
  log "Server corriendo en localhost:6666 (PID: $SERVER_PID)"
else
  err "Server falló al iniciar — revisa /tmp/coex-server.log"
  tail -5 /tmp/coex-server.log
fi

# ── 5. Frontend (vite dev) ───────────────────────────────────────────────────
echo "  [5/5] Frontend Vite dev server"

cd "$PROJECT_DIR/client"

bun run dev > /tmp/coex-client.log 2>&1 &

CLIENT_PID=$!
echo "$CLIENT_PID" >> "$PIDFILE"
sleep 2

if kill -0 "$CLIENT_PID" 2>/dev/null; then
  log "Vite dev server corriendo (PID: $CLIENT_PID)"
else
  err "Vite falló al iniciar — revisa /tmp/coex-client.log"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "  ┌──────────────────────────────────────────────────────┐"
echo "  │               Entorno levantado                      │"
echo "  ├──────────────────────────────────────────────────────┤"
echo "  │  NATS       │ localhost:4222 (k8s port-forward)      │"
echo "  │  MongoDB    │ localhost:27017 (host k8s)             │"
echo "  │  Tunnel     │ cloudflared → localhost:6666           │"
echo "  │  Server     │ http://localhost:6666                  │"
echo "  │  Frontend   │ http://localhost:5173 (proxy → 6666)   │"
echo "  ├──────────────────────────────────────────────────────┤"
echo "  │  Logs:                                               │"
echo "  │    NATS pf  → /tmp/coex-nats-pf.log                 │"
echo "  │    Tunnel   → /tmp/coex-tunnel.log                  │"
echo "  │    Server   → /tmp/coex-server.log                  │"
echo "  │    Client   → /tmp/coex-client.log                  │"
echo "  ├──────────────────────────────────────────────────────┤"
echo "  │  Para apagar: ./dev-start.sh stop                    │"
echo "  │  Tail server: tail -f /tmp/coex-server.log           │"
echo "  └──────────────────────────────────────────────────────┘"
echo ""

# Keep script alive — Ctrl+C kills everything
trap stop_all SIGINT SIGTERM

# Tail the server log in foreground so you see what's happening
tail -f /tmp/coex-server.log
