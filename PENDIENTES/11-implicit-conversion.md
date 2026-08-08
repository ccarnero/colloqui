# 11 · ValidationPipe: opciones copiadas + trampa `enableImplicitConversion`

Class: register
Summary: La opción `enableImplicitConversion` del ValidationPipe de producción convive con DTOs de arrays de objetos sin tipar en potencialmente 17 servicios; las opciones del pipe están copiadas en 4 lugares (1 de ellos producción). Origen: hallazgo de plataforma de `09-hallazgos-group-c.spec.md` T01d.

## El bug ya probado (agent-admin, cerrado)

`09-hallazgos-group-c.spec.md` T01d: `enableImplicitConversion: true` +
campo array-de-objetos sin `@Type`/`@ValidateNested` ⇒ el pipe mangla el
payload en silencio. Se arregló en agent-admin (patrón `tools`), con un test
genérico que auto-descubre campos vulnerables
(`test/unit/agents.dto.transform.spec.ts`).

## Lo que queda abierto

1. **Opciones copiadas** (paridad-por-copia, se desincronizan solas):
   - ~~Producción canónica: `bootstrap-fastify.ts:47-53`~~ **RESUELTO por T01**:
     constante `PRODUCTION_VALIDATION_PIPE_OPTIONS` en
     `packages/observability/src/validation-pipe-options.ts`, pinneada por test
     de paridad. (`bootstrap-split-service.ts` nunca tuvo copia inline — solo
     reenvía `withValidationPipe`; error del registro original.)
   - ~~api-gateway `src/main.ts:58` pipe propio~~ **RESUELTO por T01**: era
     byte-idéntico, ahora importa la constante.
   - ~~Los 3 tests de agent-admin que copiaban para paridad~~ **RESUELTO por
     T01**: importan la constante.
   - Copias que T01 NO tocó (fuera de su alcance; las levanta el barrido T02):
     `services/api-gateway/test/unit/gateway-validation-pipe.http.spec.ts:54`,
     `services/api-gateway/test/unit/runtime-execution-metadata.spec.ts:44` y
     `services/ai-agent-gateway/test/unit/executions-metadata-dto.spec.ts:43`
     arman su propio pipe con las opciones inline, byte-idénticas a las
     canónicas. Deben importar `PRODUCTION_VALIDATION_PIPE_OPTIONS` de
     `@yoizen/observability` como ya hacen los tres de agent-admin.
2. **La misma trampa puede existir en cualquiera de los ~17 servicios** que
   pasan `withValidationPipe: true` al bootstrap compartido (lista por
   `rg -l withValidationPipe services`). Nadie la barrió.

## Plan (spec `11-implicit-conversion.spec.md`)

T01 extrae las opciones a una constante exportada de `packages/observability`
(los 4 copiones la importan, test de paridad la pinnea). T02 corre el barrido
de auto-descubrimiento en los 17 servicios: los limpios quedan pinneados con
el test permanente; los sucios se registran ACÁ como hallazgos y el loop se
DETIENE para ruling de Christian antes de tocar producto.

## Hallazgos del barrido T02

(se completa al correr T02)
