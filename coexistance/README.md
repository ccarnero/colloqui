# Coexistance

Tenant-scoped integration area for the `acme` tenant.

This tree is reserved for the future `coexistance` service rollout inside the
local Yoizen platform cluster.

It intentionally stays outside the platform-wide `infrastructure/` and
`knative/` trees.

## Layout

```text
acme/coexistance/
├── app/
├── deploy/
│   ├── base/
│   └── overlays/
│       ├── orbstack/dev/
│       └── minikube/dev/
└── IMPLEMENTATION_PLAN.md
```

## Status

- The external `colloqui` source was copied into `app/`.
- First-pass runtime and visible UI rename to `coexistance` is in place.
- Debug deployment manifests are implemented under `deploy/`.
- The first rollout still assumes direct local images on OrbStack.

## Docs

- `docs/QUICKSTART.md`
- `docs/SESSION.md`
- `app/docs/YOIZEN.md`
- `deploy/docs/README.md`

See `acme/coexistance/IMPLEMENTATION_PLAN.md` for the execution
checklist and runtime decisions.
