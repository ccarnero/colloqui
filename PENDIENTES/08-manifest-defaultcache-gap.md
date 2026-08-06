# 8 · Manifest gap — `defaultCache` no declarable

Class: register
Summary: El manifiesto declarativo soporta cache por endpoint pero no el `defaultCache` a nivel conector que la UI y el SDK sí exponen.

Encontrado el 2026-08-06 durante T11 (E36b, cableado de connector-runtime a
cache-service), al verificar paridad declarativa.

## El gap

- `packages/shared/src/provisioning/manifest.schema.ts:244-278` define el bloque
  `cache` **por endpoint** (`enabled`, `ttlSeconds`, `methods`, `keyHeaders`,
  `keyQueryParams`, `keyBody`) y el writer lo pasa entero
  (`services/provisioning-service/src/modules/apply/infrastructure/connectors-writer.ts:91-92`).
- Pero el esquema **no tiene `defaultCache`** a nivel conector, mientras que la
  UI (`http-adapter-dialog`) y el SDK (`sdk/src/resources/connectors/types.ts:117`)
  sí lo soportan. Un manifiesto YAML no puede declarar un default de caché para
  todo el conector; solo endpoint por endpoint.

## Impacto

Menor. Por-endpoint es la forma más precisa y cubre todo caso de uso; lo que
falta es paridad declarativa UI/SDK ↔ manifiesto. Se vuelve molesto recién en
conectores con muchos endpoints que comparten la misma estrategia.

## Fix propuesto

Agregar `defaultCache: connectorEndpointCacheSchema.optional()` al conector en
`manifest.schema.ts`, pasarlo en `connectors-writer.ts`, y un test de apply que
pruebe herencia endpoint-sin-cache ← defaultCache. Ticket chico, independiente.
