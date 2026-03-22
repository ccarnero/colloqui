# Session

## Estado

- App copiada en `acme/coexistance/app`
- Rename de primera pasada hecho a `coexistance`
- Deployment debug funcionando en `acme-dev-ns`
- Imagen actual: `dev.local/coexistance:local`
- Health: `http://localhost:30666/api/health`
- Debug: `localhost:32229`

## Validado

- Mongo host accesible desde el pod por `mongo-host`
- NATS accesible desde el namespace
- Seed ejecutado OK
- `server/src` montado desde host con `hostPath`

## Credenciales seed

- email: `christian.carnero@gmail.com`
- password: `coexistance2024`

## Pendiente

1. exponer webhook publico para Meta
2. implementar integracion real con NATS dentro de la app
3. cleanup de docs largas del proyecto copiado

## Archivos clave

- `README.md`
- `IMPLEMENTATION_PLAN.md`
- `docs/QUICKSTART.md`
- `app/docs/YOIZEN.md`
- `deploy/docs/README.md`
