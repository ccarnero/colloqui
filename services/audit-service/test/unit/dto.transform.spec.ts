import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { type ArgumentMetadata, ValidationPipe } from "@nestjs/common";
import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "@yoizen/observability";
// Deep import of class-transformer's metadata storage — the same entry point
// `@nestjs/mapped-types` uses to inspect `@Type()` declarations.
import { defaultMetadataStorage } from "class-transformer/cjs/storage";
import { getMetadataStorage } from "class-validator";
import * as auditDto from "../../src/modules/audit/audit.dto";
import * as channelAuditDto from "../../src/modules/channel-audit/channel-audit.dto";
import * as executionAuditDto from "../../src/modules/execution-audit/execution-audit.dto";
import * as gatewayAuditDto from "../../src/modules/gateway-audit/gateway-audit.dto";

// ---------------------------------------------------------------------------
// implicit-conversion sweep (register `PENDIENTES/11-implicit-conversion.md`,
// T02) over every DTO this service exposes to the production ValidationPipe.
//
// The production pipe enables implicit conversion in its `transformOptions`
// (see `PRODUCTION_VALIDATION_PIPE_OPTIONS`). A property whose `design:type`
// is `Array` and that carries NO `@Type(...)` declaration is coerced
// element-by-element via `plainToClass(Array, element)` — every OBJECT element
// collapses to `[]`. A posted `channels: [{ type: "webchat" }]` reached
// agent-admin as `[[]]` in production while its tests, which built a pipe with
// default options, stayed green (T01d of register 09).
//
// This suite auto-discovers every DTO class of the service, auto-discovers the
// two field shapes implicit conversion can eat (untyped object arrays and
// untyped `Object`-typed fields), feeds each DTO a payload exercising those
// fields through a pipe built from THE production options, and asserts the
// payload survives verbatim. A vulnerable field added later is covered the
// moment it is declared — no test edit needed.
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

/** Structural view of a class-validator metadata record (it exports no type). */
interface IValidationMetadata {
  readonly type: string;
  readonly name?: string;
  readonly propertyName: string;
  readonly constraints?: readonly unknown[];
  readonly each?: boolean;
}

/** Every module declaring DTO classes reachable by the global pipe. */
const DTO_MODULES: Record<string, unknown>[] = [
  auditDto,
  channelAuditDto,
  executionAuditDto,
  gatewayAuditDto,
];

/**
 * Values the metadata-driven generator cannot infer (custom validators, regex
 * `@Matches` constraints). Keyed by DTO class name, then property name; each
 * entry carries the reason it must be hand-fed.
 */
const PAYLOAD_OVERRIDES: Record<string, Record<string, unknown>> = {};

/**
 * Fields this service is KNOWN to mangle under implicit conversion. They are
 * recorded as findings in `PENDIENTES/11-implicit-conversion.md` §"Hallazgos
 * del barrido T02" and excluded from the probe so the GREEN subset stays
 * pinned while the user rules on the product fix. Keyed by DTO class name.
 */
const KNOWN_MANGLED_FIELDS: Record<string, readonly string[]> = {};

/** Validators that pin a property to a scalar/array shape the generator knows. */
const SCALAR_VALIDATORS: readonly string[] = [
  "isString",
  "isNumber",
  "isInt",
  "isBoolean",
  "isEnum",
  "isIn",
  "isDate",
  "isDateString",
  "isIso8601",
  "isUuid",
  "isEmail",
  "isUrl",
  "isArray",
];

function metadataOf(target: new () => unknown): IValidationMetadata[] {
  return getMetadataStorage().getTargetValidationMetadatas(
    target,
    target.name,
    true,
    false
  ) as unknown as IValidationMetadata[];
}

function isOptionalProperty(metas: IValidationMetadata[]): boolean {
  return metas.some(
    (m) => m.type === "conditionalValidation" && m.name === "isOptional"
  );
}

function constraintOf(
  metas: IValidationMetadata[],
  name: string
): readonly unknown[] | undefined {
  return metas.find((m) => m.name === name)?.constraints;
}

/** Smallest value satisfying the property's declared validators. */
function sampleValue(metas: IValidationMetadata[]): unknown {
  const has = (name: string) => metas.some((m) => m.name === name);
  const scalar = (): unknown => {
    if (has("isEnum")) {
      const enumType = constraintOf(metas, "isEnum")?.[0] as Record<
        string,
        unknown
      >;
      return Object.values(enumType)[0];
    }
    if (has("isIn")) {
      return (constraintOf(metas, "isIn")?.[0] as unknown[])[0];
    }
    if (has("isBoolean")) {
      return true;
    }
    if (has("isInt") || has("isNumber") || has("isPositive")) {
      return (constraintOf(metas, "min")?.[0] as number | undefined) ?? 1;
    }
    if (has("isUuid")) {
      return "00000000-0000-4000-8000-000000000000";
    }
    if (has("isEmail")) {
      return "probe@example.com";
    }
    if (has("isUrl")) {
      return "https://example.com/probe";
    }
    if (has("isDateString") || has("isIso8601") || has("isDate")) {
      return new Date(0).toISOString();
    }
    if (has("isObject")) {
      return { probe: true };
    }
    const minLength = constraintOf(metas, "minLength")?.[0] as
      | number
      | undefined;
    const maxLength = constraintOf(metas, "maxLength")?.[0] as
      | number
      | undefined;
    let value = "probe";
    if (minLength && value.length < minLength) {
      value = value.padEnd(minLength, "x");
    }
    if (maxLength && value.length > maxLength) {
      value = value.slice(0, maxLength);
    }
    return value;
  };
  if (metas.some((m) => m.each)) {
    return [scalar()];
  }
  if (has("isArray")) {
    return [];
  }
  return scalar();
}

interface IDtoProbe {
  readonly name: string;
  readonly dtoClass: new () => unknown;
  /** Untyped object arrays — the shape implicit conversion is known to eat. */
  readonly objectArrayFields: string[];
  /** Untyped `Object`-typed fields carrying opaque caller data. */
  readonly untypedObjectFields: string[];
  readonly payload: Record<string, unknown>;
}

function buildProbe(name: string, dtoClass: new () => unknown): IDtoProbe {
  const all = metadataOf(dtoClass);
  const properties = [...new Set(all.map((m) => m.propertyName))].sort();
  const excluded = KNOWN_MANGLED_FIELDS[name] ?? [];
  const objectArrayFields: string[] = [];
  const untypedObjectFields: string[] = [];
  const payload: Record<string, unknown> = {};

  for (const property of properties) {
    if (excluded.includes(property)) {
      continue;
    }
    const metas = all.filter((m) => m.propertyName === property);
    const designType = Reflect.getMetadata(
      "design:type",
      dtoClass.prototype,
      property
    );
    const hasTypeDeclaration = Boolean(
      defaultMetadataStorage.findTypeMetadata(dtoClass, property)
    );
    // `{ each: true }` marks an element-wise SCALAR array: its elements are
    // strings/numbers, which implicit conversion leaves alone.
    const elementWiseScalar = metas.some((m) => m.each);
    const scalarConstrained = metas.some(
      (m) => m.name && SCALAR_VALIDATORS.includes(m.name)
    );

    if (designType === Array && !hasTypeDeclaration && !elementWiseScalar) {
      objectArrayFields.push(property);
      payload[property] = [{ probe: property }];
      continue;
    }
    if (designType === Object && !hasTypeDeclaration && !scalarConstrained) {
      untypedObjectFields.push(property);
      payload[property] = { probe: property, nested: { deep: [1, 2] } };
      continue;
    }
    if (!isOptionalProperty(metas)) {
      payload[property] = sampleValue(metas);
    }
  }

  return {
    name,
    dtoClass,
    objectArrayFields,
    untypedObjectFields,
    payload: { ...payload, ...(PAYLOAD_OVERRIDES[name] ?? {}) },
  };
}

/** Every exported class carrying class-validator metadata, deduped by class. */
function discoverDtoProbes(): IDtoProbe[] {
  const seen = new Set<unknown>();
  const probes: IDtoProbe[] = [];
  for (const dtoModule of DTO_MODULES) {
    for (const [name, exported] of Object.entries(dtoModule)) {
      if (typeof exported !== "function" || !exported.prototype) {
        continue;
      }
      const dtoClass = exported as new () => unknown;
      if (seen.has(dtoClass) || metadataOf(dtoClass).length === 0) {
        continue;
      }
      seen.add(dtoClass);
      probes.push(buildProbe(name, dtoClass));
    }
  }
  return probes.sort((a, b) => a.name.localeCompare(b.name));
}

const PROBES = discoverDtoProbes();

/**
 * The DTO classes the sweep must see. Pinned so a discovery regression (a
 * renamed module, a dropped export) cannot make this suite vacuously pass.
 */
const EXPECTED_DTO_CLASSES: readonly string[] = [
  "QueryChannelEventsDto",
  "QueryEventsDto",
  "QueryExecutionEventsDto",
  "QueryGatewayEventsDto",
];

/**
 * Snapshot of the discovered vulnerable surface, minus `KNOWN_MANGLED_FIELDS`.
 * Pinned so adding a field of either shape is a visible, reviewed change.
 */
const EXPECTED_VULNERABLE_FIELDS: Record<string, readonly string[]> = {};

describe("audit-service DTOs survive the production ValidationPipe", () => {
  it("discovers every DTO class the service declares", () => {
    expect(PROBES.map((probe) => probe.name)).toEqual([
      ...EXPECTED_DTO_CLASSES,
    ]);
  });

  it("discovers the exact set of implicit-conversion-vulnerable fields", () => {
    const discovered: Record<string, string[]> = {};
    for (const probe of PROBES) {
      const fields = [
        ...probe.objectArrayFields,
        ...probe.untypedObjectFields,
      ].sort();
      if (fields.length > 0) {
        discovered[probe.name] = fields;
      }
    }
    expect(discovered).toEqual(
      EXPECTED_VULNERABLE_FIELDS as Record<string, string[]>
    );
  });

  for (const probe of PROBES) {
    const vulnerableFields = [
      ...probe.objectArrayFields,
      ...probe.untypedObjectFields,
    ];
    if (vulnerableFields.length === 0) {
      continue;
    }

    it(`${probe.name} keeps every object-array / untyped-object field verbatim`, async () => {
      const sent = structuredClone(probe.payload);

      const result = (await productionPipe.transform(
        structuredClone(probe.payload),
        bodyMetadata(probe.dtoClass)
      )) as Record<string, unknown>;

      for (const field of vulnerableFields) {
        expect(result[field]).toEqual(sent[field]);
      }
    });

    it(`${probe.name} does not collapse object-array elements into empty arrays`, async () => {
      const result = (await productionPipe.transform(
        structuredClone(probe.payload),
        bodyMetadata(probe.dtoClass)
      )) as Record<string, unknown[]>;

      for (const field of probe.objectArrayFields) {
        const [element] = result[field];
        expect(Array.isArray(element)).toBe(false);
        expect(typeof element).toBe("object");
        expect(Object.keys(element as object).length).toBeGreaterThan(0);
      }
    });
  }
});
