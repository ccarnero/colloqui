# Deploy Notes

## Base

`deploy/base` contiene:

- `configmap.yaml` - defaults runtime
- `secret.yaml` - secretos locales de ejemplo
- `deployment.yaml` - workload debug principal
- `service.yaml` - puertos app/debug
- `mongo-host-service.yaml` - alias estable hacia Mongo host
- `seed-job.yaml` - seed one-shot

## OrbStack

`deploy/overlays/orbstack/dev` agrega:

- namespace `acme-dev-ns`
- `EndpointSlice` a `0.250.250.254` para Mongo host
- `NodePort`:
  - `30666` app
  - `32229` debug
- mount de `app/server/src` desde host

## Minikube

`deploy/overlays/minikube/dev` quedo preparado, pero no fue probado en esta sesion.

## Comandos

Aplicar OrbStack:

```bash
kubectl apply -k acme/coexistance/deploy/overlays/orbstack/dev
```

Renderizar:

```bash
kubectl kustomize acme/coexistance/deploy/overlays/orbstack/dev
kubectl kustomize acme/coexistance/deploy/overlays/minikube/dev
```

Inspeccionar:

```bash
kubectl get pod,svc,endpointslice,configmap,secret -n acme-dev-ns
kubectl logs deployment/coexistance-debug -n acme-dev-ns --tail=120
```

## Nota operativa

- el deployment hoy usa `dev.local/coexistance:local`
- no depende de la local registry
- esto es intencional hasta resolver el problema de manifests `415` en la registry
