# 6 · Cobertura e2e restante

Class: register
Summary: `mcpCall` es la única acción de workflow sin cobertura e2e; el resto se cerró esta sesión.

## Estado

| Acción | Cobertura |
|---|---|
| jsFunction · endpointCall · serviceCall · agentCall | sí (previa) |
| conditional · channelSend · branch · serviceBusCall | sí (esta sesión) |
| **mcpCall** | **no** |

## Lo que falta

`mcpCall` necesita un servidor MCP corriendo. Hay dos samples en
`integrations/mcp/` — `mcp-connections` y `mcp-repo-support-bot` — pero **hay
que verificar si alguno es hermético** (sin credenciales ni servicios externos)
antes de basar un test en él. No lo verifiqué.

Si ninguno lo es, aplica el mismo razonamiento que llevó al canal `e2e-tests`:
o se arma un fixture MCP mínimo en el cluster, o la acción se queda sin
cobertura e2e y se cubre solo por unit tests.

## Lo que NO hay que hacer

Levantar el demo de CRM como e2e. Ya se evaluó: necesita HubSpot (siembra y
borra contactos reales), OpenAI (cuesta plata y es no-determinístico) y un
túnel público de Telegram. El canal sink resolvió solo la parte de Telegram
saliente; las otras dos siguen igual.

## Y `endpointRef`: decidido que NO se construye

La vía declarativa ya existe y está documentada como "not an approximation" en
los manifiestos de `crm-support-telegram` y `http-fanout-telegram`: se usa
`adapterId` (que sí es ref) + `url` como path relativo que connector-runtime
une con el `baseUrl` del conector.

El único consumidor de un `endpointId` literal es `probeEndpointScoped` del
e2e, donde el id **es lo que se testea** (fuerza la rama
`execute-with-adapter-endpoint`). Ahí resolverlo en runtime es más correcto que
un ref: los ids de endpoint los genera el servidor y no deberían vivir en un
manifiesto.

Registrado para que no se vuelva a analizar desde cero.
