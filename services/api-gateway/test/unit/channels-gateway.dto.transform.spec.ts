import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { type ArgumentMetadata, ValidationPipe } from "@nestjs/common";
import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "@yoizen/observability";
import { SendChannelMessageBodyDto } from "../../src/modules/channels/channels-gateway.dto";

// ---------------------------------------------------------------------------
// Explicit regression test for finding H2 of register
// `PENDIENTES/11-implicit-conversion.md` (fixed by T03).
//
// `SendChannelMessageBodyDto.templateComponents` carried `@IsArray()` only over
// `Record<string, unknown>[]`. Under the production pipe's implicit conversion,
// class-transformer coerces every element via `plainToClass(Array, element)`,
// so a `template` send's components collapsed to `[[]]` on
// `POST /api/channels/:accountId/messages` — the provider then rejected the
// send or delivered the template without its variables. `@Type(() => Object)`
// stops the element-wise coercion.
//
// The payload below is the register's reproduction verbatim.
// ---------------------------------------------------------------------------

/**
 * THE production options object, imported — not copied — from
 * `@yoizen/observability`, so this suite can never validate a pipe the service
 * does not actually run.
 */
const productionPipe = new ValidationPipe(PRODUCTION_VALIDATION_PIPE_OPTIONS);

const bodyMetadata = (metatype: new () => unknown): ArgumentMetadata => ({
  type: "body",
  metatype,
  data: "",
});

const TEMPLATE_COMPONENTS = [
  { type: "body", parameters: [{ type: "text", text: "1234" }] },
];

describe("H2 — SendChannelMessageBodyDto.templateComponents survives the production pipe", () => {
  const payload = {
    to: "5491100000000",
    type: "template",
    templateName: "order_update",
    templateLanguage: "es",
    templateComponents: TEMPLATE_COMPONENTS,
  };

  it("keeps the template components byte-for-byte", async () => {
    const result = (await productionPipe.transform(
      { ...payload },
      bodyMetadata(SendChannelMessageBodyDto as unknown as new () => unknown)
    )) as Record<string, unknown>;

    expect(result.templateComponents).toEqual(TEMPLATE_COMPONENTS);
  });

  it("does not collapse the components into an empty array", async () => {
    const result = (await productionPipe.transform(
      { ...payload },
      bodyMetadata(SendChannelMessageBodyDto as unknown as new () => unknown)
    )) as { templateComponents: unknown[] };

    expect(JSON.stringify(result.templateComponents)).toBe(
      JSON.stringify(TEMPLATE_COMPONENTS)
    );
  });
});
