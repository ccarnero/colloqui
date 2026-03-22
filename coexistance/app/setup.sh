#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# Coexistance — Setup script
#
# Prerequisitos:
#   - bun (o node >= 18)
#   - MongoDB corriendo (local o remoto, configurado en .env)
#
# Qué hace:
#   1. Verifica que exista .env (si no, copia .env.example)
#   2. Instala dependencias (server + client)
#   3. Ejecuta seed (crea user + sandbox account)
#   4. Buildea el frontend
#   5. Muestra instrucciones para levantar
# ─────────────────────────────────────────────────────────

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# ── Colores ──────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

# ── 1. Detectar runtime ─────────────────────────────────

echo ""
echo "  Coexistance — Setup"
echo "  ──────────────────"
echo ""

if command -v bun &>/dev/null; then
  RT="bun"
  RUN="bun"
  ok "Runtime: bun $(bun --version)"
elif command -v node &>/dev/null; then
  RT="node"
  RUN="node"
  NODE_V=$(node --version | sed 's/v//')
  MAJOR=$(echo "$NODE_V" | cut -d. -f1)
  if [ "$MAJOR" -lt 18 ]; then
    fail "Node $NODE_V detectado. Se necesita >= 18."
  fi
  ok "Runtime: node $NODE_V"
else
  fail "No se encontró bun ni node. Instalá uno de los dos."
fi

# ── 2. Verificar .env ───────────────────────────────────

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn ".env no existía — copiado desde .env.example. Editalo con tus valores."
  else
    fail "No se encontró .env ni .env.example"
  fi
else
  ok ".env encontrado"
fi

# ── 3. Verificar MongoDB ────────────────────────────────

MONGO_URI=$(grep '^MONGODB_URI=' .env | cut -d'=' -f2-)

if [ -z "$MONGO_URI" ]; then
  fail "MONGODB_URI vacío en .env"
fi

# Intentar conectar (timeout 5s)
if command -v mongosh &>/dev/null; then
  if mongosh "$MONGO_URI" --eval "db.runCommand({ping:1})" --quiet --norc 2>/dev/null | grep -q '"ok" : 1\|"ok":1\|ok: 1'; then
    ok "MongoDB accesible: $MONGO_URI"
  else
    warn "No se pudo verificar MongoDB. Asegurate de que esté corriendo."
  fi
else
  warn "mongosh no encontrado — no se puede verificar la conexión a MongoDB. Asegurate de que esté corriendo."
fi

# ── 4. Instalar dependencias ────────────────────────────

echo ""
echo "  Instalando dependencias..."
echo ""

# Server
cd "$ROOT_DIR/server"
npm install --silent 2>&1 | tail -1
ok "server/node_modules instalado"

# Client
cd "$ROOT_DIR/client"
npm install --silent 2>&1 | tail -1
ok "client/node_modules instalado"

cd "$ROOT_DIR"

# ── 5. Seed (user + sandbox account) ────────────────────

echo ""
echo "  Ejecutando seed..."
echo ""

$RUN server/src/scripts/seed.js 2>&1 || warn "Seed falló — verificá que MongoDB esté corriendo"

# ── 6. Build frontend ───────────────────────────────────

echo ""
echo "  Buildeando frontend..."
echo ""

cd "$ROOT_DIR/client"
npx vite build --logLevel error 2>&1
ok "Frontend build → client/dist/"

cd "$ROOT_DIR"

# ── 7. Listo ─────────────────────────────────────────────

echo ""
echo "  ──────────────────────────────────────────────────"
echo ""
echo "  Setup completo. Para levantar:"
echo ""
echo "    cd $(basename "$ROOT_DIR")"
echo ""
echo "    # Opción A: server sirve todo (API + frontend build)"
echo "    $RUN server/src/server.js"
echo ""
echo "    # Opción B: dev mode (hot reload en frontend)"
echo "    $RUN server/src/server.js &     # backend en :6666"
echo "    cd client && npx vite           # frontend en :5173"
echo ""
echo "    Después abrí: http://localhost:6666"
echo ""
echo "    Login:"
echo "      email:    christian.carnero@gmail.com"
echo "      password: coexistance2024"
echo ""
echo "  ──────────────────────────────────────────────────"
echo ""
