# PR: Add OrbStack Support, Remove Tilt & Cursor

## Resumen

Este PR agrega soporte completo de Kubernetes local via [OrbStack](https://orbstack.dev/), elimina el flujo de trabajo de Tilt.dev, elimina todas las referencias al IDE Cursor, agrega pre-compilación del paquete `packages/observability` en los scripts de bootstrap, y reorganiza la documentación técnica bajo la carpeta `DOCS/`.

---

## Changes

### 1. OrbStack Kubernetes Support (new)

Previously the project only supported Minikube for local Kubernetes. OrbStack is now a first-class provider with its own overlay and bootstrap script.

**New files:**

| File | Purpose |
|------|---------|
| `bootstrap-orbstack.sh` | OrbStack equivalent of `bootstrap.sh` |
| `infrastructure/overlays/orbstack/kustomization.yaml` | Root OrbStack overlay |
| `infrastructure/overlays/orbstack/namespaces.yaml` | 8 namespaces (support + platform × 4 envs) |
| `infrastructure/overlays/orbstack/storage-class-compat.yaml` | StorageClass aliases (see below) |
| `infrastructure/overlays/orbstack/orbstack-base/` | Base patches for OrbStack |
| `infrastructure/overlays/orbstack/{dev,qa,staging,production}/` | Per-environment overlays |

**Why a separate overlay?**

Kustomize overlays let us keep the base manifests provider-agnostic and apply only the differences per environment or provider. OrbStack needs two things that differ from a cloud cluster:

1. **StorageClass** — OrbStack only ships `rancher.io/local-path`. Cloud clusters use `standard`, `gp2`, `gp3`, `standard-rwo`, or `managed-premium`. Without a fix, PVCs stay in `Pending` forever.
2. **Resource limits** — Lower CPU/memory limits suitable for a laptop.

`storage-class-compat.yaml` registers all common cloud StorageClass names as aliases for `local-path` so unmodified base manifests resolve correctly.

**Temporal IPv6 fix (`infrastructure/base/temporal/deployment.yaml`)**

OrbStack assigns pods an IPv6 address as the primary IP. `temporalio/auto-setup` auto-detects that IP and binds its gRPC server to IPv6 only. kubelet tcpSocket probes use IPv4, so they get "connection refused" and the pod enters CrashLoopBackOff.

Fix: added `BIND_ON_IP: "0.0.0.0"` env var so Temporal listens on all interfaces.

Also added a `startupProbe` with a 5-minute window to cover the auto-setup database migration that runs on first boot.

**Quick start with OrbStack:**

```bash
./bootstrap-orbstack.sh          # deploy everything to dev
./bootstrap-orbstack.sh qa       # deploy to qa
./bootstrap-orbstack.sh --help   # see all options
```

---

### 2. Removed Tilt.dev

| Removed | Reason |
|---------|--------|
| `Tiltfile` | Developer workflow file — replaced by bootstrap scripts |
| `TILT.md` | Documentation for the removed tooling |
| References in `skills/setup.sh` | Cleanup |

---

### 3. Removed Cursor IDE References

| Removed | What it was |
|---------|------------|
| `.cursor/` directory | Cursor IDE configuration and plans |
| `.cursorrules` | Cursor-specific rules file |
| `--cursor` option in `skills/setup.sh` | CLI flag and `setup_cursor()` function |
| `CURSOR.md` entry in `.gitignore` | File no longer tracked |
| `.cursor` entry in `.dockerignore` | Directory no longer exists |

The AI assistant setup script (`skills/setup.sh`) still configures Claude, Gemini, Codex, GitHub Copilot, and OpenCode.

---

### 4. README Actualizado

`README.md` ahora documenta ambas rutas de setup (Minikube y OrbStack), prerrequisitos actualizados y la estructura del proyecto actualizada.

---

### 5. Pre-build de `packages/observability`

Ambos scripts de bootstrap (`bootstrap.sh` y `bootstrap-orbstack.sh`) fallaban silenciosamente cuando los Dockerfiles de los servicios intentaban importar el paquete local `packages/observability` sin que este estuviera compilado.

**Cambio:** Se agregó la función `build_packages()` en ambos scripts, que se ejecuta **antes** de `build_images()`:

```bash
build_packages() {
  npm install --prefix "${script_dir}/packages/observability"
  npm run build --prefix "${script_dir}/packages/observability"
}
```

**Orden de ejecución resultante:**
1. `apply_infrastructure`
2. **`build_packages`** ← nuevo
3. `build_images`
4. `apply_knative_config`

---

### 6. Reorganización de documentación en `DOCS/`

Los archivos de documentación técnica se separaron de los directivos de agentes IA para evitar confusión. Los archivos de agentes (`AGENTS.md`, `CLAUDE.md`, `CURSOR.md`, `GEMINI.md`) permanecen en la raíz porque los AI tools los buscan ahí.

| Archivo | Movido a |
|---------|----------|
| `ARCHITECTURE.md` | `DOCS/ARCHITECTURE.md` |
| `README.md` (completo) | `DOCS/README.md` |
| `REVIEW.md` | `DOCS/REVIEW.md` |

`README.md` en raíz es ahora un stub que apunta a `DOCS/README.md` (requerido para que GitHub muestre la homepage del repo).

Todas las referencias a `REVIEW.md` en archivos de agentes (`.claude/Claude.md`, `.gemini/gemini.md`, y los 5 `setup.sh`) fueron actualizadas a `DOCS/REVIEW.md`.

---

## Testing

Tested end-to-end on macOS with OrbStack 1.9:

```
deployment "temporal" successfully rolled out
deployment "nats" successfully rolled out
deployment "redis" successfully rolled out
deployment "postgres" successfully rolled out
```

PVCs bound correctly using `local-path` StorageClass on all StatefulSets.

---

## Files Changed

```
bootstrap-orbstack.sh                                   (new)
PR.md                                                   (new)
README.md                                               (modified — stub, full docs moved to DOCS/)
infrastructure/base/temporal/deployment.yaml            (modified — BIND_ON_IP + startupProbe)
infrastructure/overlays/orbstack/                       (new — 11 files)
skills/setup.sh                                         (modified — Cursor refs removed, DOCS/REVIEW.md refs updated)
.gitignore                                              (modified)
.dockerignore                                           (modified)
Tiltfile                                                (deleted)
TILT.md                                                 (deleted)
.cursor/                                                (deleted)
.cursorrules                                            (deleted)
bootstrap.sh                                            (modified — build_packages() added)
bootstrap-orbstack.sh                                   (modified — build_packages() added)
DOCS/ARCHITECTURE.md                                    (new — moved from root)
DOCS/README.md                                          (new — moved from root)
DOCS/REVIEW.md                                          (new — moved from root)
.claude/Claude.md                                       (modified — DOCS/REVIEW.md ref)
.gemini/gemini.md                                       (modified — DOCS/REVIEW.md ref)
.claude/skills/setup.sh                                 (modified — DOCS/REVIEW.md refs)
.gemini/skills/setup.sh                                 (modified — DOCS/REVIEW.md refs)
.codex/skills/setup.sh                                  (modified — DOCS/REVIEW.md refs)
.github/skills/setup.sh                                 (modified — DOCS/REVIEW.md refs)
ARCHITECTURE.md                                         (deleted — moved to DOCS/)
REVIEW.md                                               (deleted — moved to DOCS/)
```
