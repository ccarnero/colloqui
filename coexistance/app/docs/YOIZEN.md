# Yoizen Notes

## Que se cambio

- nombre del proyecto: `coexistance`
- packages:
  - `coexistance`
  - `coexistance-server`
  - `coexistance-client`
- branding visible en UI cambiado a `Coexistance`
- claves de localStorage:
  - `coexistance_token`
  - `coexistance_remember`
  - `coexistance_active_account_id`
- password seed actual: `coexistance2024`
- `.env.example` ahora incluye `NATS_URL`
- `Dockerfile` agregado para correr en cluster local

## Scripts utiles

Raiz:

```bash
bun run dev
bun run debug
bun run build
bun run seed
```

Server:

```bash
cd server
bun run dev
bun run debug
bun run seed
bun test
```

Client:

```bash
cd client
bun run dev
bun run build
```

## Que no esta hecho todavia

- la app no publica ni consume NATS aun
- el webhook publico de Meta no esta expuesto todavia
- hay docs largas heredadas que todavia no se limpiaron
