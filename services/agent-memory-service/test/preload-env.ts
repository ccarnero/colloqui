// MUST be first: TypeScript's `__metadata` helper is a no-op while
// `Reflect.metadata` is undefined, so any DTO module evaluated before
// `reflect-metadata` loads silently loses its `design:type` emission — exactly
// what production's `main.ts` avoids by importing it first. Without this,
// suite-wide file order decides whether `test/unit/dto.transform.spec.ts` can
// see the reflected property types it sweeps (register 11, T02).
import "reflect-metadata";

process.env.POSTGRES_PASSWORD ??= "test-unit-secret";
process.env.STORAGE_ENGINE ??= "postgres";
