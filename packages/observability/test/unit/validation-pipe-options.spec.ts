import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Imported from the definition module rather than the package index on purpose:
// `src/index.ts` re-exports `./telemetry`, whose OTLP exporter chain crashes
// on import under Bun (`createContextKey is not a function`). The index export
// itself is pinned by the last test in this file.
import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "../../src/validation-pipe-options";

// ---------------------------------------------------------------------------
// Parity pin for THE production ValidationPipe options.
//
// These options used to live inline in `bootstrap-fastify.ts`, in
// `api-gateway/src/main.ts`, and in three agent-admin test harnesses. T01d of
// register PENDIENTES/09-hallazgos-group-c.spec.md proved what that costs:
// `enableImplicitConversion` collapsed untyped object-array DTO fields to `[]`
// in production while the harnesses — which built their own pipes — stayed
// green. Register PENDIENTES/11-implicit-conversion.md collapsed the copies
// into one exported constant.
//
// This suite makes any edit to that constant a VISIBLE, wire-adjacent change:
// changing a value or adding a key here fails loudly instead of silently
// re-tuning request validation for every HTTP service on the platform.
// ---------------------------------------------------------------------------

const SRC_DIR = join(import.meta.dir, "..", "..", "src");

function readSource(file: string): string {
  return readFileSync(join(SRC_DIR, file), "utf8");
}

describe("PRODUCTION_VALIDATION_PIPE_OPTIONS", () => {
  it("pins the exact option values", () => {
    expect(PRODUCTION_VALIDATION_PIPE_OPTIONS.whitelist).toBe(true);
    expect(PRODUCTION_VALIDATION_PIPE_OPTIONS.forbidNonWhitelisted).toBe(true);
    expect(PRODUCTION_VALIDATION_PIPE_OPTIONS.transform).toBe(true);
    expect(
      PRODUCTION_VALIDATION_PIPE_OPTIONS.transformOptions
        ?.enableImplicitConversion
    ).toBe(true);
  });

  it("pins the exact option SHAPE — a new key is a deliberate change, not a drive-by", () => {
    expect(PRODUCTION_VALIDATION_PIPE_OPTIONS).toEqual({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });
    expect(Object.keys(PRODUCTION_VALIDATION_PIPE_OPTIONS).sort()).toEqual([
      "forbidNonWhitelisted",
      "transform",
      "transformOptions",
      "whitelist",
    ]);
    expect(
      Object.keys(PRODUCTION_VALIDATION_PIPE_OPTIONS.transformOptions ?? {})
    ).toEqual(["enableImplicitConversion"]);
  });

  // STRUCTURAL PROOF — why source text and not a runtime assertion:
  // `app.useGlobalPipes()` swallows the pipe (Nest exposes no public getter for
  // the registered global pipes), and `ValidationPipe` destructures its options
  // in the constructor, so an instance cannot be compared back to the object it
  // was built from either. The alternatives — exporting a builder, or mocking
  // `@nestjs/common` process-wide to spy on the constructor — both change
  // production code or leak a module mock into the package's other suites. The
  // cheapest non-invasive proof that the bootstrap uses the CONSTANT and not a
  // revived inline literal is therefore the bootstrap's own source.
  describe("bootstrap-fastify.ts builds its pipe FROM the constant", () => {
    const bootstrapSource = readSource("bootstrap-fastify.ts");

    it("imports the constant", () => {
      expect(bootstrapSource).toContain(
        'import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "./validation-pipe-options";'
      );
    });

    it("constructs a fresh ValidationPipe from it", () => {
      expect(bootstrapSource).toContain(
        "new ValidationPipe(PRODUCTION_VALIDATION_PIPE_OPTIONS)"
      );
    });

    it("carries no inline copy of the options", () => {
      expect(bootstrapSource).not.toContain("enableImplicitConversion:");
      expect(bootstrapSource).not.toContain("forbidNonWhitelisted:");
    });
  });

  it("keeps `validation-pipe-options.ts` as the ONLY definition site in the package", () => {
    // Any other src file re-declaring the options is a fourth copy in the
    // making — exactly the drift this constant exists to kill.
    const offenders = readdirSync(SRC_DIR)
      .filter((file) => file.endsWith(".ts"))
      .filter(
        (file) =>
          file !== "validation-pipe-options.ts" &&
          readSource(file).includes("enableImplicitConversion:")
      )
      .sort();
    expect(offenders).toEqual([]);
  });

  it("is exported from the package index", () => {
    const indexSource = readSource("index.ts");
    expect(indexSource).toContain("PRODUCTION_VALIDATION_PIPE_OPTIONS");
    expect(indexSource).toContain('from "./validation-pipe-options"');
  });
});
