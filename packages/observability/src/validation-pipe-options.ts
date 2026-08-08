import type { ValidationPipeOptions } from "@nestjs/common";

/**
 * THE production `ValidationPipe` contract for every HTTP service on the
 * platform. Single source of truth: `bootstrapFastifyApp` (and therefore
 * `bootstrapSplitService`) builds its global pipe from this object, and
 * api-gateway — which boots its own pipe instead of using the shared flag —
 * imports it too, so no service can drift by editing a private copy.
 *
 * Values are byte-identical to the inline object these bootstraps carried
 * before the extraction; this constant changed WHERE the options live, never
 * WHAT they are. Editing any value here changes the request-validation
 * behaviour of every service at once — treat it as a wire-adjacent change and
 * expect the parity pin test (`test/unit/validation-pipe-options.spec.ts`) to
 * fail until the new shape is deliberately re-pinned.
 *
 * WHY TEST HARNESSES IMPORT IT: `transformOptions.enableImplicitConversion`
 * silently mangles DTO fields whose reflected `design:type` is `Array` and that
 * carry no `@Type(...)` declaration — class-transformer coerces each element
 * with `plainToClass(Array, element)`, so every object element collapses to
 * `[]`. A posted `channels: [{ type: "webchat" }]` reached agent-admin as
 * `[[]]` in production while its tests, which built a pipe with default
 * options, stayed green. That finding (T01d of register
 * `PENDIENTES/09-hallazgos-group-c.spec.md`, generalised by register
 * `PENDIENTES/11-implicit-conversion.md`) is why every e2e/integration/unit
 * harness that exercises a DTO must build its pipe from THIS object rather
 * than hand-copying the options: a copy is a test that validates a pipe the
 * service never runs.
 *
 * Construct a fresh `new ValidationPipe(PRODUCTION_VALIDATION_PIPE_OPTIONS)`
 * per boot / per harness. NestJS's `ValidationPipe` does not mutate the object
 * it is given (it destructures it in the constructor), but a pipe INSTANCE
 * carries per-app state, so instances are never shared across apps.
 */
export const PRODUCTION_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: {
    enableImplicitConversion: true,
  },
};
