# Shared kustomize components

Reusable patch bundles, composed via `components: [...]` from every
overlay that needs them.

## Why components and not plain `patches:`?

Kustomize's default `loadRestrictor: rootOnly` blocks `patches:` from
referencing files outside the overlay's directory tree. Components
solve this cleanly: each component is its own kustomization root, so
the patches it ships are local to it, and overlays compose them via
`components:` without violating the load restrictor.

## Available components

| Component | Used by | Effect |
|---|---|---|
| `scale-to-zero-non-prod/` | `local/{dev,qa}` + `cloud/{dev,qa}` | Knative `min-scale: 0` on every service except `api-gateway`; KEDA `minReplicaCount: 0` with base cooldown (120-180s). |
| `scale-to-zero-staging/` | `local/staging` + `cloud/staging` | Same Knative annotations; KEDA `minReplicaCount: 0` with `cooldownPeriod: 300s` to dampen canary thrash. |

## Convention

`api-gateway` is **never** patched — it stays warm in every
environment because cold-starting the entry point kills DX (devs
hitting save → reload) and breaks smoke tests in CI / canary.

## Adding a new component

1. Create a new folder under `_components/<name>/`.
2. Drop a `kustomization.yaml` with `kind: Component` and the patch
   list you need.
3. Reference it from any overlay with:
   ```yaml
   components:
     - ../../_components/<name>
   ```
