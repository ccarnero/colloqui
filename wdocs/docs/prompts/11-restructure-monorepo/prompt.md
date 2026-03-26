# Stage 11 — Reestructurar monorepo: server/ y client/ al root

## Objetivo

Mover `server/` y `client/` fuera de `app/` (o lo que sea el directorio actual) para que queden al mismo nivel que `package.json`, `.env`, y `Dockerfile`. La estructura final:

```
coexistance/
├── server/
├── client/
├── docs/
├── .env
├── .env.example
├── package.json
├── bun.lock
├── Dockerfile
├── setup.sh
└── .gitignore
```

Si la estructura YA es así (server/ y client/ al mismo nivel que package.json), responde "ESTRUCTURA CORRECTA — SKIP" y no hagas nada.

## Contexto

El monorepo usa Bun workspaces. `server/` y `client/` son los dos workspaces. Hay exactamente **6 archivos** con paths relativos que dependen de la profundidad del árbol. El cambio es mecánico pero hay que verificar que nada se rompa.

## Reglas

- Functional programming, no classes
- Result types `{ ok, data }` / `{ ok, error }` — nunca throw
- Bun runtime, Express, MongoDB native driver
- Vitest para tests
- KISS — no agregar complejidad, solo mover y ajustar paths

---

## Paso 1 — Verificar estructura actual

```bash
# Desde el root del repo
ls -la package.json server/package.json client/package.json .env Dockerfile 2>&1
```

Si `server/` y `client/` ya están al nivel de `package.json`, este stage NO APLICA. Respond "SKIP" y termina.

Si están dentro de un subdirectorio (ej: `app/server/`, `app/client/`), continúa.

---

## Paso 2 — Mover directorios al root

```bash
# Desde el root del proyecto (donde está el .git)
mv app/server ./server
mv app/client ./client
mv app/docs ./docs 2>/dev/null || true

# Mover configs al root (si no están ya ahí)
mv app/package.json ./package.json
mv app/bun.lock ./bun.lock 2>/dev/null || true
mv app/package-lock.json ./package-lock.json 2>/dev/null || true
mv app/.env ./.env
mv app/.env.example ./.env.example
mv app/Dockerfile ./Dockerfile
mv app/.dockerignore ./.dockerignore 2>/dev/null || true
mv app/setup.sh ./setup.sh
mv app/.gitignore ./.gitignore 2>/dev/null || true

# Limpiar el directorio vacío
rmdir app 2>/dev/null || echo "app/ no está vacío — revisar qué queda"
ls app/ 2>/dev/null && echo "CUIDADO: quedan archivos en app/"
```

---

## Paso 3 — Ajustar paths relativos (6 archivos)

### 3.1 `server/src/config/env.js`

El path al `.env` cambia de 3 niveles arriba a 2:

```javascript
// ANTES:
config({ path: resolve(import.meta.dir, '../../../.env') })

// DESPUÉS:
config({ path: resolve(import.meta.dir, '../../.env') })
```

**Explicación:** Antes era `server/src/config/ → ../../.. → app/.env`. Ahora es `server/src/config/ → ../.. → root/.env`.

### 3.2 `server/src/server.js`

El path al `client/dist` cambia de 2 niveles a 1:

```javascript
// ANTES:
const clientDist = resolve(import.meta.dir, '../../client/dist')

// DESPUÉS:
const clientDist = resolve(import.meta.dir, '../../../client/dist')
```

**WAIT — verificar.** `import.meta.dir` apunta a `server/src/`. Desde ahí:
- Antes (dentro de app): `server/src/ → ../.. → app/ → client/dist` ✓ (2 niveles)
- Ahora (root): `server/src/ → ../.. → root/ → client/dist` ✓ (2 niveles, MISMO)

**RESULTADO: este path NO cambia** porque `server/` y `client/` mantienen la misma relación entre sí. Ambos subieron un nivel, la distancia relativa es la misma.

Verifica con:
```bash
# Desde server/src/
node -e "const {resolve} = require('path'); console.log(resolve('server/src', '../../client/dist'))"
# Debe imprimir: /ruta/al/proyecto/client/dist
```

### 3.3 `server/src/scripts/seed.js`

```javascript
// ANTES:
const envPath = resolve(import.meta.dirname || '.', '../../../.env')

// DESPUÉS:
const envPath = resolve(import.meta.dirname || '.', '../../.env')
```

**Explicación:** `scripts/` está en `server/src/scripts/`. Antes necesitaba 3 niveles para llegar a `app/.env`. Ahora necesita 2 para llegar a `root/.env`. Wait — verifiquemos:

- `server/src/scripts/` → `../../..` = 3 niveles arriba
- Antes: `app/server/src/scripts/ → 3 up → app/` ✓
- Ahora: `server/src/scripts/ → 3 up → (parent of root)` ✗ — ESTO SÍ ESTÁ MAL

Corrección: desde `server/src/scripts/`, subir 3 niveles ahora va a **arriba** del root. Necesitamos solo **subir 3 niveles** porque estamos 1 nivel menos profundo:

- Antes: `app/server/src/scripts/` → `../../../` → `app/` (nivel 4 → nivel 1)
- Ahora: `server/src/scripts/` → `../../../` → `../` (nivel 3 → nivel 0 = root... PERO eso es correcto!)

Hmm, pensemos con posiciones absolutas:
- Root = nivel 0
- `server/` = nivel 1
- `server/src/` = nivel 2
- `server/src/scripts/` = nivel 3

Desde nivel 3, `../../..` sube 3 = nivel 0 = root. **CORRECTO, NO CAMBIA.**

Verifiquemos `config/env.js`:
- `server/src/config/` = nivel 3
- Antes: `../../../` = 3 up. Estaba en `app/server/src/config/` (nivel 4) → subía a `app/` (nivel 1). Path era `app/.env` ✓
- Ahora: `../../../` = 3 up. Está en `server/src/config/` (nivel 3) → sube a root parent (**nivel -1**) ✗

**ESTE SÍ CAMBIA.** Recalculando:
- Ahora `server/src/config/` = profundidad 3 desde root
- `.env` está en root = profundidad 0
- Necesitamos subir 3 niveles: `../../../.env` ✓

WAIT. Antes estaba en `app/server/src/config/` = profundidad 4 desde el root del GIT REPO. Y apuntaba a `app/.env` que estaba a profundidad 1. Subía `../../../` = 3 niveles, de 4 a 1. Correcto.

Ahora está en `server/src/config/` = profundidad 3 desde el root del REPO. Y `.env` está a profundidad 0. Subir `../../../` = 3 niveles, de 3 a 0. **CORRECTO, NO CAMBIA.**

**RESULTADO FINAL: los paths `../../../.env` NO cambian** porque movimos TODO un nivel arriba. La profundidad relativa entre los archivos dentro de server/ y el .env se mantiene.

### Verificación de TODOS los paths

Ejecuta este script para verificar:

```bash
echo "=== Verificando paths ==="

# Desde config/env.js
ENV_FROM_CONFIG=$(cd server/src/config && realpath ../../../.env 2>/dev/null || echo "FALLA")
echo "config/env.js → ../../../.env = $ENV_FROM_CONFIG"

# Desde scripts/seed.js
ENV_FROM_SEED=$(cd server/src/scripts && realpath ../../../.env 2>/dev/null || echo "FALLA")
echo "scripts/seed.js → ../../../.env = $ENV_FROM_SEED"

# Desde scripts/fix-account.js
ENV_FROM_FIX=$(cd server/src/scripts && realpath ../../../.env 2>/dev/null || echo "FALLA")
echo "scripts/fix-account.js → ../../../.env = $ENV_FROM_FIX"

# Desde server/src/server.js → client/dist
CLIENT_FROM_SERVER=$(cd server/src && realpath ../../client/dist 2>/dev/null || echo "FALLA (ok si no hay build)")
echo "server.js → ../../client/dist = $CLIENT_FROM_SERVER"

# Todos deben apuntar al root del proyecto
echo ""
echo "Root del proyecto: $(pwd)"
echo "Si los paths resuelven correctamente, NO hay que cambiar nada en los imports."
```

---

## Paso 4 — Ajustar el path si la verificación falla

SOLO si el script del Paso 3 muestra "FALLA" en algún path, ajusta ese archivo específico.

La lógica es:
- **Antes:** `app/` era el directorio que contenía `.env`, `server/`, `client/`
- **Ahora:** el root del repo contiene `.env`, `server/`, `client/`
- Si `app/` estaba EN el root del repo, los paths relativos **no cambian**
- Si `app/` ERA el root del repo (es decir, `.git` estaba dentro de `app/`), tampoco cambian

**El único caso donde cambian es si `app/` NO era el root del repo y `.env` estaba DENTRO de `app/`.** En ese caso, `.env` sube un nivel y los paths necesitan un `../` menos.

---

## Paso 5 — Ajustar Dockerfile

Si los paths no cambiaron (caso más probable), el Dockerfile NO necesita cambios — ya usa paths relativos desde el WORKDIR `/app` que es internal al container.

Verifica que el Dockerfile sigue funcionando:

```bash
# Dry-run — solo verifica que el build context encuentra los archivos
ls -la Dockerfile package.json bun.lock server/package.json client/package.json .env.example
```

Si todo existe al mismo nivel que `Dockerfile`, está OK.

---

## Paso 6 — Ajustar setup.sh

`setup.sh` usa `ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"` — como el script se movió al root junto con todo lo demás, `ROOT_DIR` sigue siendo correcto. Los `cd "$ROOT_DIR/server"` y `cd "$ROOT_DIR/client"` siguen apuntando bien.

**No requiere cambios.**

---

## Paso 7 — Ajustar dev-start.sh

El `dev-start.sh` está en `docs/flujos/dev-start.sh` y usa:

```bash
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
```

Esto sube 2 niveles desde `docs/flujos/`. Verifica que llegue al root:

```bash
cd docs/flujos && realpath ../..
# Debe ser el root del proyecto
```

Si `docs/` se movió al root, esto es correcto. **No requiere cambios.**

---

## Paso 8 — Reinstalar dependencias

```bash
# Limpiar node_modules viejo (podría tener symlinks rotos)
rm -rf node_modules

# Reinstalar desde el root
bun install
```

---

## Paso 9 — Verificar que todo funciona

### 9.1 Tests

```bash
cd server && bun run test
```

**Criterio:** todos los tests pasan. Si alguno falla por path, ajustar SOLO ese path.

### 9.2 Server startup

```bash
bun run dev
# Esperar 3 segundos, verificar log
# Debe mostrar: "Coexistance server running: http://localhost:6666"
# Ctrl+C para salir
```

### 9.3 Client build

```bash
cd client && bun run build
# Debe generar client/dist/ sin errores
```

### 9.4 Seed (idempotente)

```bash
bun run seed
# Debe ejecutar sin errores
```

### 9.5 Health check

```bash
bun run dev &
sleep 3
curl -s http://localhost:6666/api/health | grep -q '"ok"' && echo "PASS" || echo "FAIL"
kill %1
```

---

## Paso 10 — Limpiar

```bash
# Si quedó algo en app/
ls app/ 2>/dev/null && echo "Revisar qué queda en app/" || echo "app/ eliminado correctamente"

# Verificar .gitignore incluye node_modules
grep -q 'node_modules' .gitignore || echo 'node_modules' >> .gitignore
```

---

## Resultado esperado

```
coexistance/
├── .env
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── package.json
├── bun.lock
├── setup.sh
├── server/
│   ├── package.json
│   └── src/
│       ├── server.js
│       ├── config/env.js
│       ├── bus/
│       ├── services/
│       ├── routes/
│       ├── scripts/
│       └── ...
├── client/
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── lib/
│       ├── pages/
│       └── ...
└── docs/
    ├── arquitectura/
    └── flujos/
```

Tests pasan, server arranca, client builda, seed corre. Zero cambios en los imports internos (solo se confirmó que los paths relativos siguen resolviendo correctamente).

---

## Notas

- **NO** renombrar archivos ni funciones — solo mover directorios
- **NO** cambiar imports entre módulos de server — son todos relativos dentro de `server/src/`
- **NO** tocar imports del client — no referencia filesystem del server
- Si algún test falla, el error probablemente sea un path al `.env` de test — ajustar solo ese caso
- El Dockerfile sigue funcionando porque su WORKDIR `/app` es interno al container y no tiene relación con el directorio `app/` del host
