# Quickstart

## Requisitos

- contexto `orbstack`
- MongoDB corriendo en tu host en `27017`
- platform cluster base ya levantado

## Build de imagen

```bash
docker build \
  -t dev.local/coexistance:local \
  -f acme/coexistance/app/Dockerfile \
  acme/coexistance/app
```

## Deploy

```bash
kubectl apply -k acme/coexistance/deploy/overlays/orbstack/dev
kubectl rollout status deployment/coexistance-debug -n acme-dev-ns
```

## Verificar

```bash
curl http://localhost:30666/api/health
kubectl logs deployment/coexistance-debug -n acme-dev-ns --tail=120
```

## Debugger

```bash
python3 - <<'PY'
import socket
s = socket.socket(); s.settimeout(5); s.connect(("localhost", 32229)); print("debug open"); s.close()
PY
kubectl logs deployment/coexistance-debug -n acme-dev-ns | grep debug.bun.sh
```

## Rerun del seed

```bash
kubectl delete job coexistance-seed -n acme-dev-ns --ignore-not-found
kubectl apply -k acme/coexistance/deploy/overlays/orbstack/dev
kubectl logs job/coexistance-seed -n acme-dev-ns
```

## Loop de desarrollo

- si cambias `app/server/src`, Bun recarga solo
- si cambias dependencias, `package.json`, Dockerfile o frontend: rebuild de imagen y `kubectl rollout restart deployment/coexistance-debug -n acme-dev-ns`

## Webhook publico

Siguiente paso sugerido:

```bash
cloudflared tunnel --url http://localhost:30666
```
