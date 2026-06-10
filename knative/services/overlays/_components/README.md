# Shared kustomize components

Reusable patch bundles, composed via `components: [...]` from overlays
that need them.

## Why components and not plain `patches:`?

Kustomize's default `loadRestrictor: rootOnly` blocks `patches:` from
referencing files outside the overlay's directory tree. Components
solve this cleanly: each component is its own kustomization root, so
the patches it ships are local to it, and overlays compose them via
`components:` without violating the load restrictor.

## Developer mode

The developer config (single-node, `dev` overlay only) does NOT use any
scale-to-zero components. Every Knative Service and every worker
Deployment runs at `min-scale=max-scale=1` — no scale-to-zero, no KEDA.

The `scale-to-zero-non-prod/` and `scale-to-zero-staging/` directories
remain on disk for historical reference but are not referenced by any
active overlay. They were previously used by the now-deleted
`qa`, `staging`, and `cloud/` overlays.

## Convention

`api-gateway` is **never** patched — it stays warm in every
configuration because cold-starting the entry point kills DX and breaks
smoke tests.

## Adding a new component

1. Create a new folder under `_components/<name>/`.
2. Drop a `kustomization.yaml` with `kind: Component` and the patch
   list you need.
3. Reference it from any overlay with:
   ```yaml
   components:
     - ../../_components/<name>
   ```
