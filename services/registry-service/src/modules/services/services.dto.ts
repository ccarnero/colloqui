import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  type ValidationOptions,
} from "class-validator";

export type { Environment } from "@yoizen/shared";
export { VALID_ENVIRONMENTS } from "@yoizen/shared";

// manual-loops/provisioning-manifest-gaps-4.md T04 (Option B — k8s-native
// `valueFrom.secretKeyRef`, human ruling 2026-07-24). `envVars` used to be a
// PLAIN-STRINGS-ONLY map (`provisioning-manifest-gaps-2.md` T05, gap 5,
// human ruling 2026-07-16). This widens each value to EITHER a plain string
// (unchanged) OR a `{ secretKeyRef: { name, key } }` reference — the SAME
// k8s-native shape `env[].valueFrom.secretKeyRef` uses natively. This
// service NEVER resolves a `secretKeyRef` to a value itself: it only
// forwards the reference into the Knative spec (`knative-builder.ts`) and
// persists it as-is (`services.postgres.repository.ts` /
// `services.mongo.repository.ts`) — k8s resolves the actual value at pod
// start. A single `envVars` map may legally mix both shapes.
export type ServiceEnvVarValue =
  | string
  | { secretKeyRef: { name: string; key: string } };

export type ServiceEnvVars = Record<string, ServiceEnvVarValue>;

function isValidServiceEnvVarValue(value: unknown): boolean {
  if (typeof value === "string") {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "secretKeyRef") {
    return false;
  }
  const ref = (value as { secretKeyRef: unknown }).secretKeyRef;
  if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
    return false;
  }
  const refKeys = Object.keys(ref as Record<string, unknown>).sort();
  if (refKeys.length !== 2 || refKeys[0] !== "key" || refKeys[1] !== "name") {
    return false;
  }
  const { name, key } = ref as { name: unknown; key: unknown };
  return (
    typeof name === "string" &&
    name.length > 0 &&
    typeof key === "string" &&
    key.length > 0
  );
}

/**
 * Validates `envVars` is an object whose every value is either a plain
 * string or a `{ secretKeyRef: { name, key } }` reference (never a bare
 * `secretRef` string, never a resolved secret value — this service is not
 * the resolution boundary, `provisioning-service`'s existence check is).
 */
function IsServiceEnvVarsRecord(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: "isServiceEnvVarsRecord",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined) {
            return true;
          }
          if (
            typeof value !== "object" ||
            value === null ||
            Array.isArray(value)
          ) {
            return false;
          }
          return Object.values(value as Record<string, unknown>).every(
            isValidServiceEnvVarValue
          );
        },
        defaultMessage(): string {
          return "envVars must be an object whose values are either strings or { secretKeyRef: { name, key } }";
        },
      },
    });
  };
}

export class RegisterServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message:
      "name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen",
  })
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  image!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScale?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxScale?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  concurrencyTarget?: number;

  @IsOptional()
  @IsServiceEnvVarsRecord()
  envVars?: ServiceEnvVars;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  image?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScale?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxScale?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  concurrencyTarget?: number;

  @IsOptional()
  @IsServiceEnvVarsRecord()
  envVars?: ServiceEnvVars;
}
