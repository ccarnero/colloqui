# http-connectors — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de aplicar `manifest.yaml`, la plataforma queda con **cinco connectors HTTP de salida**
(adaptadores declarativos con `context = external`): cuatro sin autenticación
(`jsonplaceholder`, `httpbin`, `pokeapi`, `catfacts`) y uno con Basic auth
(`httpbin-basic-auth`), con **31 endpoints** registrados en total. No se crea ningún workflow ni
canal: el comportamiento observable es que cualquier workflow del tenant puede, desde ese
momento, invocar esas APIs públicas mediante una acción `endpointCall` sin conocer URLs,
cabeceras ni credenciales. Es la contraparte de salida de
[`sdk/examples/reference-pattern`](../../../sdk/examples/reference-pattern) (que empuja mensajes
*hacia adentro* de la plataforma). El provisioning es **declarativo**: un único
[`manifest.yaml`](./manifest.yaml) aplicado con la CLI `yoizen` (sin scripts de setup).

## `kind: LibraryManifest`

Este manifest existe solo para provisionar un catálogo de connectors compartido — no declara
ningún canal ni ningún agente/workflow propio. `validate-structural-rules.ts` exige por defecto
al menos un canal inbound y al menos un "proceso" (agente o workflow) en todo manifest; el marcador
`kind: LibraryManifest` (ruling humano del 2026-07-16) exime esas dos reglas y exige en su lugar
al menos un recurso real (connector/mcpServer/service/systemVariable) — satisfecho aquí por los 5
connectors. Ver el comentario de cabecera de `manifest.yaml` para el detalle completo.

## Los connectors declarados

| Connector | Auth | Base URL | Endpoints | Particularidad |
| --- | --- | --- | --- | --- |
| `jsonplaceholder` | none | `jsonplaceholder.typicode.com` | 9 (CRUD completo sobre `/posts` + `/todos`, `/users`, `/comments`) | Cubre GET/POST/PUT/PATCH/DELETE |
| `httpbin` | none | `httpbin.org` | 11 (`/get`, `/post`, `/uuid`, `/headers`, `/ip`, …) | API espejo para inspeccionar requests |
| `pokeapi` | none | `pokeapi.co` | 6 (`/api/v2/pokemon/ditto`, abilities, types, …) | Solo lectura |
| `catfacts` | none | `catfact.ninja` | 3 (`/fact`, `/facts`, `/breeds`) | Caché declarada por endpoint (ver más abajo) |
| `httpbin-basic-auth` | basic | `httpbin.org` | 2 (`/basic-auth/...`, `/hidden-basic-auth/...`) | Credenciales via `secretRef` anidado |

> **Nota de estado existente.** Estos 5 connectors ya existen en vivo (recreados el 2026-07-16 vía
> el `setup.ts` ahora eliminado). Los nombres del manifest coinciden exactamente con los connectors
> en vivo, así que `apply` los reconcilia (update/noop) en lugar de duplicarlos.

## Secretos (Basic auth)

`httpbin-basic-auth` usa `auth.authType: basic` con dos bindings `secretRef` anidados — el
manifest nunca lleva una credencial literal:

| Binding (= var de entorno para `--secrets-from-env`) | Apunta a | Valor por defecto (reproduce el comportamiento original) |
| --- | --- | --- |
| `httpbin-basic-auth-username` | `authConfig.basicUsername` | `user` |
| `httpbin-basic-auth-password` | `authConfig.basicPassword` | `passwd` |

**Limitación documentada (no es un gap silencioso).** El script eliminado reescribía
dinámicamente credenciales y paths de endpoint juntos al sobreescribirlos, para que nunca queden
desincronizados. Un manifest estático no puede hacer eso: para usar credenciales Basic distintas
hay que editar **tanto** los valores de los secretos **como** los dos `path` de endpoint en
`manifest.yaml`, a mano. Setear solo uno de los dos (para forzar un mismatch de prueba) sigue
siendo posible y se comporta igual que en el sample original: httpbin responde `401`.

## Gap documentado — `defaultCache` a nivel connector (NO se descarta, se re-expresa)

El `setup.ts` eliminado hacía `PATCH` de un `defaultCache` a **nivel connector** sobre `catfacts`
(mapeado a la columna `default_cache_strategy` de connector-admin). El schema de manifest v1
(`connectorSchema`) no tiene un campo `defaultCache` a nivel connector — solo el `cache` **por
endpoint** (`endpoints[].cache`, misma forma exacta: `enabled`/`ttlSeconds`/`methods`/
`keyHeaders`/`keyQueryParams`/`keyBody`). Como el `defaultCache` de `catfacts` declaraba
`methods: ["GET", "HEAD"]` y sus 3 endpoints son GET, `manifest.yaml` adjunta el **mismo** objeto
de caché a cada uno de los 3 endpoints de `catfacts` — una re-expresión fiel al nivel de
granularidad que el schema sí soporta, no una aproximación ni una funcionalidad descartada. Ver
el comentario del propio `manifest.yaml` para el razonamiento completo, incluyendo por qué esta
traducción NO generalizaría sin pérdida a un connector cuyos endpoints usen métodos distintos.

## Cómo ejecutarlo y qué esperar

Prerrequisitos: un clúster de desarrollo corriendo, la CLI `yoizen`, y las variables de entorno
habituales (`YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
`YOIZEN_PASSWORD`).

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/http/http-connectors/manifest.yaml
yoizen manifests plan     -f ../integrations/http/http-connectors/manifest.yaml
env 'httpbin-basic-auth-username=user' 'httpbin-basic-auth-password=passwd' \
  yoizen manifests apply  -f ../integrations/http/http-connectors/manifest.yaml --secrets-from-env
```

Una segunda `apply` es un no-op una vez convergido. Para verificar el catálogo (solo lectura):

```bash
cd integrations/http/http-connectors
./run.sh
```

`run.sh` (`src/index.ts`) lista los connectors `context=external` y confirma que los 5 declarados
en el manifest existen, imprimiendo id, `authType` y cantidad de endpoints de cada uno. Nunca crea
ni modifica objetos de la plataforma — aplicar el manifest primero.

## Invocar un connector desde un workflow

Los connectors se consumen con la actividad `endpointCall` (ver `EndpointCallArgs` en
`packages/shared/src/workflow.interfaces.ts`), con tres formas válidas: `adapterId` +
`endpointId` (todo resuelto por el connector), `adapterId` + `url` como path relativo (se une al
`baseUrl` del connector, headers/auth/timeouts del connector siguen aplicando), o sin `adapterId`
(`url` absoluta, timeout fijo de 30 s, sin auth de adapter).

## Detalles y advertencias

- **`context` debe ser `external`.** Estos son APIs de terceros; el contexto `internal` es el
  espejo de servicios propios que administra `registry-service`.
- **Unicidad `(method, path)` por connector.** El apply engine reconcilia cada endpoint declarado
  contra los endpoints en vivo por esa clave — no por orden ni por un id declarado en el manifest.
- **Provisionar ≠ poder llamar.** El connector se crea aunque la API pública no sea alcanzable; en
  runtime la llamada sale desde **dentro del clúster** (egress), no desde la laptop.
- **El directorio `connectors/*.json`** guarda los cinco payloads previos al manifest. NO los lee
  `manifest.yaml`, ni `run.sh`, ni `src/index.ts` (el provisioning es 100 % declarativo), pero
  tampoco están muertos: `scripts/e2e/README.md` usa `pokeapi.json` como body listo para un
  `POST /api/connectors`. Si cambiás la forma de un connector, sincronizalos a mano.
- **Credenciales de ejemplo, no secretos reales.** `user`/`passwd` son valores públicos de prueba
  de httpbin. Para connectors reales, las credenciales deben salir de un secret store real, nunca
  de un archivo commiteado (el manifest ya lo garantiza por schema: `auth` es `secretRef`-only).
