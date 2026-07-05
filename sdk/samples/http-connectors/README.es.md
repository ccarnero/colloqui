# http-connectors — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de ejecutar `./setup.sh`, la plataforma queda con **cinco connectors HTTP de salida**
(adaptadores declarativos con `context = external`): cuatro sin autenticación
(`jsonplaceholder`, `httpbin`, `pokeapi`, `catfacts`) y uno con Basic auth
(`httpbin-basic-auth`), con **31 endpoints** registrados en total. No se crea ningún workflow ni
canal: el comportamiento observable es que cualquier workflow del tenant puede, desde ese
momento, invocar esas APIs públicas mediante una acción `endpointCall` sin conocer URLs,
cabeceras ni credenciales. Es la contraparte de salida de `http-bridge` (que empuja mensajes
*hacia adentro* de la plataforma).

## Escenario de uso

Un equipo integra su plataforma con varias APIs de terceros (un CRM, un servicio de geocoding, un
proveedor de pagos). En lugar de repetir en cada workflow la URL base, los timeouts, los reintentos
y las credenciales, define cada API una sola vez como un **connector declarativo**: un archivo JSON
con `baseUrl`, `authType`, `endpoints[]` y, si conviene, una caché declarativa (`defaultCache`).
Los workflows solo referencian el connector por `adapterId` y el endpoint por su `(method, path)`;
si mañana cambia la credencial o el timeout, se edita el JSON y se re-ejecuta el setup — ningún
workflow se toca.

Traza de ejemplo (desde un workflow cualquiera):

```
endpointCall { adapterId: <catfacts>, method: "GET", url: "/fact" }
  → connector-runtime resuelve baseUrl + auth + caché → GET https://catfact.ninja/fact
  → respuesta cacheada 300 s (defaultCache) → { "fact": "Cats sleep 70% of their lives." }
```

## Cómo funciona por dentro

### Lo que provisiona setup.sh (vía `@yoizen/platform-sdk`, 3 etapas + recreate opcional)

`setup.sh` solo resuelve el entorno (`../lib/resolve-env.sh`) y ejecuta `src/setup.ts` con
`npx tsx`; toda la lógica de provisioning vive ahí, usando el recurso `connectors` del SDK. El
login queda a cargo del cliente del SDK de forma transparente en la primera request, por eso la
numeración de etapas salta directo de `0/3` a `2/3` (misma convención que `http-bridge`).

| Etapa | Qué hace |
| --- | --- |
| 0 preflight | Valida que cada JSON de `connectors/` sea parseable (falla rápido ante uno malformado) |
| recreate (opcional) | Con `RECREATE=1` borra **todos** los connectors `context=external` antes de reprovisionar |
| 2 upsert | Por cada archivo de `connectors/`: crea o reutiliza el connector por nombre, aplica `update()` de `defaultCache` si el JSON lo declara, y reconcilia endpoints |
| 3 summary | Imprime contadores `created / reused / endpoints added / failed` |

El script es un **upsert verdadero e idempotente**:

- El connector se crea con `endpoints = []` y luego la reconciliación agrega cada endpoint — así
  toda alta queda registrada y contada de forma uniforme, sea el connector nuevo o preexistente.
- La reconciliación compara por la clave única `(method, path)` **por connector**: solo agrega los
  pares declarados en el JSON que aún no existen; el resto queda intacto. Agregar un endpoint al
  archivo y re-ejecutar aplica exactamente ese delta.
- Un 409 "already exists" (carrera con otra corrida) se trata como éxito, no como error.
- Si hay connectors duplicados con el mismo nombre, el script auto-repara: conserva el primero y
  borra los demás.

### Los connectors declarados (archivos de `connectors/`)

| Connector | Auth | Base URL | Endpoints | Particularidad |
| --- | --- | --- | --- | --- |
| `jsonplaceholder` | none | `jsonplaceholder.typicode.com` | 9 (CRUD completo sobre `/posts` + `/todos`, `/users`, `/comments`) | Cubre GET/POST/PUT/PATCH/DELETE |
| `httpbin` | none | `httpbin.org` | 11 (`/get`, `/post`, `/uuid`, `/headers`, `/ip`, …) | API espejo para inspeccionar requests |
| `pokeapi` | none | `pokeapi.co` | 6 (`/api/v2/pokemon/ditto`, abilities, types, …) | Solo lectura |
| `catfacts` | none | `catfact.ninja` | 3 (`/fact`, `/facts`, `/breeds`) | Declara `defaultCache` |
| `httpbin-basic-auth` | basic | `httpbin.org` | 2 (`/basic-auth/...`, `/hidden-basic-auth/...`) | Credenciales en `authConfig` |

Cada JSON es un `CreateAdapterDto` completo: `name`, `context`, `baseUrl`, `authType`,
`authConfig`, `endpoints[]` (con `label` descriptivo), más `timeoutMs`, `maxRetries`,
`retryBackoffMs`, `healthCheckPath` y `tags`. Para agregar otro connector basta con soltar un
archivo nuevo en `connectors/` y re-ejecutar.

### Conceptos de plataforma involucrados

- **Caché declarativa (`defaultCache`).** `catfacts` declara `enabled: true`, `ttlSeconds: 300`,
  `methods: ["GET","HEAD"]`, `keyQueryParams: "all"`: las respuestas GET se cachean 300 segundos.
  El script hace `PATCH` de `defaultCache` en **cada** corrida, así que editar la caché en
  `catfacts.json` y re-ejecutar aplica el cambio sin `RECREATE=1`.
- **Auth resuelta por el connector, no por el llamador.** Para `authType: "basic"`,
  `applyAdapterAuthHeadersSync` codifica `basicUsername:basicPassword` en base64 y agrega el
  header `Authorization: Basic …` en cada request — el workflow nunca ve las credenciales.
- **Sincronía credenciales/URL en httpbin.** El endpoint `/basic-auth/<user>/<passwd>` de httpbin
  lleva las credenciales *esperadas* en el path. Al sobreescribir `HTTPBIN_BASIC_USER` /
  `HTTPBIN_BASIC_PASS`, el script reescribe **tanto** el `authConfig` **como** los paths de los
  endpoints basic-auth, para que nunca se desincronicen.
- **Tres formas de invocación de `endpointCall`** (ver `EndpointCallArgs`):
  1. `adapterId` + `endpointId` — todo (método, path, headers, auth, timeouts) sale del connector.
  2. `adapterId` + `url` como path (p. ej. `/posts/1`) — se une al `baseUrl` del connector;
     headers/auth/timeouts del connector siguen aplicando.
  3. Sin `adapterId` — `url` absoluta, timeout fijo de 30 s, sin reintentos ni auth de adapter.

## Qué demuestra técnicamente

- Definición declarativa de adaptadores de salida: un JSON por API de terceros, versionable en git.
- Upsert idempotente con reconciliación por drift: solo se aplica la diferencia entre el archivo y
  el estado de la plataforma.
- `defaultCache` como configuración del connector (no del workflow), reconciliada vía `PATCH`.
- Resolución de autenticación en el lado plataforma (`authType: basic` → header `Authorization`).
- CRUD completo de connectors y endpoints vía gateway (`/api/connectors`,
  `/api/connectors/:id/endpoints`).

Referencias de contrato (verificadas en código): `services/api-gateway/src/modules/connectors/connectors.controller.ts`
(rutas del gateway, prefijo global `api`), `services/connector-admin/src/modules/adapters/adapters.controller.ts`
+ `adapters.service.ts` (create/list, unicidad `(method, path)`), `packages/shared/src/adapter.interfaces.ts`
(`AdapterConfig`), `packages/shared/src/adapter-auth-headers.ts` (Basic auth),
`packages/shared/src/workflow.interfaces.ts` (`EndpointCallArgs`).

## Cómo ejecutarlo y qué esperar

Prerrequisitos: Node >=18 y una plataforma alcanzable (por defecto el clúster de desarrollo).
No requiere Telegram ni ningún otro sample.

```bash
cd sdk/samples/http-connectors
./setup.sh    # o ./run.sh, que es equivalente (resuelve el entorno y ejecuta setup.sh)
```

Resultado esperado en la primera corrida: `connectors: created=5 reused=0 endpoints added=31 failed=0`,
con una línea `+ <METHOD> <path> (<label>)` por endpoint. En una segunda corrida:
`reuse '<name>' — exists` y `endpoints already up to date`, sin crear nada. Los connectors se
listan con `GET /api/connectors?context=external` (el summary imprime el `curl` exacto), y sus
ids son los que consumen los workflows (por ejemplo, `http-fanout-telegram`).

## Detalles y advertencias

- **`context` debe ser `external`.** Estos son APIs de terceros; el contexto `internal` es el
  espejo de servicios propios que administra `registry-service`.
- **Unicidad `(method, path)` por connector.** `GET /post` y `POST /post` son filas distintas; la
  reconciliación compara exactamente ese par.
- **"already exists" no es un error.** El par `(name, tenant)` es único: si el create devuelve
  409, el script lo registra como reuse y continúa con la reconciliación de endpoints.
- **`401` en `httpbin-basic-auth`** significa que las credenciales Basic no coinciden con los
  segmentos del path. Sobreescribir solo una de `HTTPBIN_BASIC_USER` / `HTTPBIN_BASIC_PASS` es la
  forma deliberada de provocar el mismatch; el script en condiciones normales las mantiene en
  sincronía.
- **Provisionar ≠ poder llamar.** El connector se crea aunque la API pública no sea alcanzable; en
  runtime la llamada sale desde **dentro del clúster** (egress), no desde la laptop.
- **Credenciales de ejemplo, no secretos reales.** `user`/`passwd` son valores públicos de prueba
  de httpbin. Para connectors reales, las credenciales deben salir de un secret store, no de un
  JSON commiteado.
- **`RECREATE=1` es destructivo a nivel tenant:** borra *todos* los connectors `context=external`
  (no solo los de este sample) antes de reprovisionar desde los archivos.
