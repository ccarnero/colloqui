import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static guard for the root cause behind a real production incident: when a
 * DTO class used only as a `@Body()`/`@Query()` parameter TYPE ANNOTATION is
 * imported via `import type`, TypeScript's `tsc` (the compiler the Docker
 * build uses — see `Dockerfile`, which runs `tsc` then ships `dist/*.js`,
 * NOT the raw TS source) cannot reference the erased binding when emitting
 * `design:paramtypes` for `emitDecoratorMetadata`, and falls back to the
 * generic `Function` global. NestJS's `ValidationPipe.toValidate()` does
 * NOT skip `Function` (only `[String, Boolean, Number, Array, Object,
 * Buffer, Date]`), so it validates the body against `Function`'s (always
 * empty) class-validator metadata — rejecting every real field with
 * `"property X should not exist"`.
 *
 * bun's own transpiler does NOT reproduce this (it preserves the runtime
 * reference even for `import type`), so this bug is invisible to `bun test`
 * unless asserted statically here. Pair with
 * `gateway-validation-pipe.http.spec.ts`, which exercises the real HTTP
 * path with the real global `ValidationPipe`.
 */

const GATEWAY_SRC = join(import.meta.dir, "../../src");

/** [controller file, DTO class names that MUST be value-imported]. */
const CASES: [string, string[]][] = [
  ["modules/workflows/workflows.controller.ts", ["ExecuteWorkflowGatewayDto"]],
  [
    "modules/admin/admin-agents.controller.ts",
    [
      "AdminAgentsListQueryDto",
      "CreateAgentDto",
      "UpdateAgentDto",
      "UpdateEnabledMcpServersDto",
      "UpdateEnabledToolsDto",
      "UpdateToolDescriptionOverridesDto",
    ],
  ],
  [
    "modules/admin/admin-jobs.controller.ts",
    [
      "AdminJobExecutionsListQueryDto",
      "AdminJobsListQueryDto",
      "CreateJobDto",
      "TriggerJobDto",
      "UpdateJobDto",
    ],
  ],
  ["modules/admin/admin-structured-kb.controller.ts", ["QueryStructuredKbDto"]],
];

describe("DTOs used as @Body()/@Query() metatypes must be value imports", () => {
  for (const [relativePath, dtoNames] of CASES) {
    const source = readFileSync(join(GATEWAY_SRC, relativePath), "utf8");

    for (const dtoName of dtoNames) {
      it(`${relativePath}: ${dtoName} is not imported via 'import type'`, () => {
        // Matches `import type { ..., DtoName, ... } from "..."`, tolerant
        // of the import spanning multiple lines.
        const typeOnlyImport = new RegExp(
          `import\\s+type\\s*\\{[^}]*\\b${dtoName}\\b[^}]*\\}`,
          "s"
        );
        expect(source).not.toMatch(typeOnlyImport);

        // And it must actually be imported as a value somewhere (guards
        // against the assertion above passing only because the name was
        // renamed/removed).
        const valueImport = new RegExp(
          `import\\s*\\{[^}]*\\b${dtoName}\\b[^}]*\\}\\s*from`,
          "s"
        );
        expect(source).toMatch(valueImport);
      });
    }
  }
});
