import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from "@nestjs/common";
import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "@yoizen/observability";
import {
  CreateAgentDto,
  QueryStructuredKbDto,
  UpdateAgentDto,
} from "../../src/modules/admin/admin.dto";

// ---------------------------------------------------------------------------
// Explicit regression tests for findings H1 and H5 of register
// `PENDIENTES/11-implicit-conversion.md` (fixed by T03).
//
// H1 — `CreateAgentDto.channels` / `.input_variables` / `.output_variables` and
// `UpdateAgentDto.channels` carried `@IsArray() @IsOptional()` over `unknown[]`
// with NO `@Type(() => Object)`. Under the production pipe's implicit
// conversion, class-transformer coerces every element via
// `plainToClass(Array, element)`, so each object element collapsed to `[]`:
// a posted `channels: [{ type: "webchat" }]` reached agent-admin as `[[]]`,
// silently, with a 2xx. Same bug T01d of register 09 fixed one hop downstream.
//
// H5 — `QueryStructuredKbDto.categories` is declared `string[]` but validated
// with `@IsArray()` only, so an object element was mangled to `[[]]` and
// forwarded instead of being rejected. `@IsString({ each: true })` turns that
// into a 400.
//
// The payloads below are the register's reproductions verbatim.
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

/** H1 reproduction payload, byte-for-byte from the register. */
const TOOLS = [{ type: "search", name: "search_tickets" }];
const CHANNELS = [{ type: "webchat", config: { widget_id: "w-1" } }];
const INPUT_VARIABLES = [
  { name: "customer_name", type: "string", required: true },
];
const OUTPUT_VARIABLES = [
  { name: "resolution", type: "string", required: false },
];

describe("H1 — CreateAgentDto object arrays survive the production pipe", () => {
  const payload = {
    name: "support-bot",
    system_prompt: "You are a support assistant",
    tools: TOOLS,
    channels: CHANNELS,
    input_variables: INPUT_VARIABLES,
    output_variables: OUTPUT_VARIABLES,
  };

  it("keeps channels, input_variables and output_variables byte-for-byte", async () => {
    const result = (await productionPipe.transform(
      { ...payload },
      bodyMetadata(CreateAgentDto as unknown as new () => unknown)
    )) as Record<string, unknown>;

    expect(result.tools).toEqual(TOOLS);
    expect(result.channels).toEqual(CHANNELS);
    expect(result.input_variables).toEqual(INPUT_VARIABLES);
    expect(result.output_variables).toEqual(OUTPUT_VARIABLES);
  });

  it("does not collapse any object element into an empty array", async () => {
    const result = (await productionPipe.transform(
      { ...payload },
      bodyMetadata(CreateAgentDto as unknown as new () => unknown)
    )) as Record<string, unknown[]>;

    for (const field of [
      "channels",
      "input_variables",
      "output_variables",
    ] as const) {
      const [element] = result[field];
      expect(`${field}: ${JSON.stringify(element)}`).toBe(
        `${field}: ${JSON.stringify(payload[field][0])}`
      );
    }
  });
});

describe("H1 — UpdateAgentDto object arrays survive the production pipe", () => {
  it("keeps channels byte-for-byte on the update path", async () => {
    const result = (await productionPipe.transform(
      { name: "support-bot", tools: TOOLS, channels: CHANNELS },
      bodyMetadata(UpdateAgentDto as unknown as new () => unknown)
    )) as Record<string, unknown>;

    expect(result.tools).toEqual(TOOLS);
    expect(result.channels).toEqual(CHANNELS);
  });
});

describe("H5 — QueryStructuredKbDto.categories validates its elements", () => {
  it("still accepts the legit string-array payload", async () => {
    const result = (await productionPipe.transform(
      { query: "cuanto sale el plan", categories: ["tarifas"] },
      bodyMetadata(QueryStructuredKbDto as unknown as new () => unknown)
    )) as Record<string, unknown>;

    expect(result.categories).toEqual(["tarifas"]);
  });

  it("rejects object elements with a 400 instead of forwarding [[]]", async () => {
    const error = await productionPipe
      .transform(
        { query: "cuanto sale el plan", categories: [{ name: "tarifas" }] },
        bodyMetadata(QueryStructuredKbDto as unknown as new () => unknown)
      )
      .then(
        (value) => value,
        (thrown: unknown) => thrown
      );

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      statusCode: number;
      message: string[];
    };
    expect(response.statusCode).toBe(400);
    // The message must name the offending field — the whole point of the fix is
    // that the client learns `categories` was wrong instead of silently getting
    // `[[]]` persisted downstream.
    expect(response.message.join(" | ")).toMatch(/categories/);
  });
});
