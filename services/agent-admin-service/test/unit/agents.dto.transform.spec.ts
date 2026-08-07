import "../setup-env";
import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { type ArgumentMetadata, ValidationPipe } from "@nestjs/common";
// Deep import of class-transformer's metadata storage — the same entry point
// `@nestjs/mapped-types` uses to inspect `@Type()` declarations.
import { defaultMetadataStorage } from "class-transformer/cjs/storage";
import { getMetadataStorage } from "class-validator";
import {
  CreateAgentDto,
  UpdateAgentDto,
} from "../../src/modules/agents/agents.dto";

// ---------------------------------------------------------------------------
// Regression guard for the implicit-conversion data loss on agent DTOs.
//
// The global pipe runs with `transformOptions.enableImplicitConversion: true`
// (packages/observability/src/bootstrap-fastify.ts:45-51). With implicit
// conversion on, an `unknown[]` property whose reflected design:type is `Array`
// and that carries NO `@Type(() => Object)` is coerced element-by-element via
// `plainToClass(Array, element)` — every object element collapses to `[]`.
// A posted `channels: [{ type: "webchat" }]` reached the service as `[[]]`.
//
// These tests run the EXACT production pipe options over the DTOs and assert
// object arrays survive verbatim, plus a generic sweep so that a seventh
// untyped object-array field added later fails here immediately.
// ---------------------------------------------------------------------------

/** Copied verbatim from packages/observability/src/bootstrap-fastify.ts:45-51. */
const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: {
    enableImplicitConversion: true,
  },
});

const bodyMetadata = (metatype: new () => unknown): ArgumentMetadata => ({
  type: "body",
  metatype,
  data: "",
});

const TOOLS = [{ type: "search", name: "search_tickets" }];
const CHANNELS = [{ type: "webchat", config: { widget_id: "w-1" } }];
const INPUT_VARIABLES = [
  {
    name: "customer_name",
    type: "string",
    required: true,
    description: "Name",
  },
];
const OUTPUT_VARIABLES = [
  { name: "resolution", type: "string", required: false },
];

/** Object-array payload shared by both DTOs (Update accepts every Create field). */
const objectArrayPayload = {
  tools: TOOLS,
  channels: CHANNELS,
  input_variables: INPUT_VARIABLES,
  output_variables: OUTPUT_VARIABLES,
};

/** Fields that must keep object elements intact through the production pipe. */
const OBJECT_ARRAY_FIELDS = [
  "tools",
  "channels",
  "input_variables",
  "output_variables",
] as const;

type ObjectArrayField = (typeof OBJECT_ARRAY_FIELDS)[number];

/**
 * Every property whose reflected type is `Array` and that is NOT validated
 * element-wise as a scalar (`{ each: true }`). Those are exactly the
 * object-array fields, and each one needs `@Type(() => Object)` to survive
 * implicit conversion.
 */
function objectArrayProperties(target: new () => unknown): string[] {
  const validationMetadata = getMetadataStorage().getTargetValidationMetadatas(
    target,
    target.name,
    true,
    false
  );
  const scalarElementProps = new Set(
    validationMetadata.filter((m) => m.each).map((m) => m.propertyName)
  );
  const arrayProps = new Set<string>();
  for (const meta of validationMetadata) {
    const prop = meta.propertyName;
    if (scalarElementProps.has(prop) || arrayProps.has(prop)) {
      continue;
    }
    const designType = Reflect.getMetadata(
      "design:type",
      target.prototype,
      prop
    );
    if (designType === Array) {
      arrayProps.add(prop);
    }
  }
  return [...arrayProps].sort();
}

describe.each([
  ["CreateAgentDto", CreateAgentDto as unknown as new () => unknown],
  ["UpdateAgentDto", UpdateAgentDto as unknown as new () => unknown],
])("%s — object arrays survive the production ValidationPipe", (_name, dtoClass) => {
  const basePayload =
    dtoClass === (CreateAgentDto as unknown as new () => unknown)
      ? { name: "Transform Agent", system_prompt: "You are a test assistant" }
      : { name: "Transform Agent" };

  it("keeps every object-array field verbatim", async () => {
    const result = (await productionPipe.transform(
      { ...basePayload, ...objectArrayPayload },
      bodyMetadata(dtoClass)
    )) as Record<ObjectArrayField, unknown>;

    expect(result.tools).toEqual(TOOLS);
    expect(result.channels).toEqual(CHANNELS);
    expect(result.input_variables).toEqual(INPUT_VARIABLES);
    expect(result.output_variables).toEqual(OUTPUT_VARIABLES);
  });

  it("does not collapse object elements into empty arrays", async () => {
    const result = (await productionPipe.transform(
      { ...basePayload, ...objectArrayPayload },
      bodyMetadata(dtoClass)
    )) as Record<ObjectArrayField, unknown[]>;

    for (const field of OBJECT_ARRAY_FIELDS) {
      const [element] = result[field];
      expect(Array.isArray(element)).toBe(false);
      expect(typeof element).toBe("object");
      expect(Object.keys(element as object).length).toBeGreaterThan(0);
    }
  });

  it("declares @Type(() => Object) on every object-array property", () => {
    const properties = objectArrayProperties(dtoClass);

    // Sanity: the sweep must actually see the known object-array fields, so a
    // metadata-reading regression cannot make this test vacuously pass.
    expect(properties).toEqual([...OBJECT_ARRAY_FIELDS].sort());

    for (const property of properties) {
      const typeMetadata = defaultMetadataStorage.findTypeMetadata(
        dtoClass,
        property
      );
      expect(typeMetadata).toBeDefined();
    }
  });

  it("keeps object elements for any object-array property, including future ones", async () => {
    const properties = objectArrayProperties(dtoClass);
    const payload: Record<string, unknown> = { ...basePayload };
    for (const property of properties) {
      payload[property] = [{ probe: property }];
    }

    const result = (await productionPipe.transform(
      payload,
      bodyMetadata(dtoClass)
    )) as Record<string, unknown[]>;

    for (const property of properties) {
      expect(result[property]).toEqual([{ probe: property }]);
    }
  });
});
