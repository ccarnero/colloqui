/**
 * Trigger validator. The serializer emits a single trigger when an
 * inbound channel node exists. We mirror `WorkflowTriggerDto` from
 * `services/workflow-service/.../workflow-trigger.dto.ts`:
 *
 *   - type: "message_received" (only supported)
 *   - mode: "exclusive" | "shared"
 *   - config.channels[]   (optional, ∈ {whatsapp, instagram, telegram})
 *   - config.providers[]  (optional, ∈ {meta, telegram})
 *   - config.accountIds[] (optional, strings)
 *   - config.patterns[]   (optional, strings)
 */

import type { ValidationError } from "./validation.types";

const VALID_TRIGGER_TYPES = ["message_received"];
const VALID_TRIGGER_MODES = ["exclusive", "shared"];
const VALID_CHANNELS = ["whatsapp", "instagram", "telegram"];
const VALID_PROVIDERS = ["meta", "telegram"];

interface TriggerContext {
  /** Visual node key of the inbound CHANNEL node, when known. */
  nodeKey?: string;
  nodeName?: string;
}

export function validateTrigger(
  trigger: unknown,
  ctx: TriggerContext = {},
): ValidationError[] {
  if (typeof trigger !== "object" || trigger === null) {
    return [
      {
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "trigger",
        code: "INVALID_VALUE",
        message: "Trigger must be an object.",
      },
    ];
  }

  const t = trigger as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (!VALID_TRIGGER_TYPES.includes(t["type"] as string)) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "trigger.type",
      code: "INVALID_ENUM",
      message: `Trigger type must be one of ${VALID_TRIGGER_TYPES.join(", ")}.`,
    });
  }

  if (!VALID_TRIGGER_MODES.includes(t["mode"] as string)) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "trigger.mode",
      code: "INVALID_ENUM",
      message: `Trigger mode must be one of ${VALID_TRIGGER_MODES.join(", ")}.`,
    });
  }

  const config = t["config"];
  const isMessageReceived = t["type"] === "message_received";

  if (config === undefined || config === null) {
    if (isMessageReceived) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "trigger.config.accountIds",
        code: "REQUIRED",
        message:
          "At least one channel account is required for the trigger.",
      });
    }
    return errors;
  }

  if (typeof config !== "object") {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "trigger.config",
      code: "INVALID_VALUE",
      message: "Trigger config must be an object.",
    });
    return errors;
  }

  const cfg = config as Record<string, unknown>;
  errors.push(
    ...validateConfigArray(cfg, "channels", VALID_CHANNELS, ctx),
    ...validateConfigArray(cfg, "providers", VALID_PROVIDERS, ctx),
    ...validateStringArray(cfg, "accountIds", ctx),
    ...validateStringArray(cfg, "patterns", ctx),
  );

  if (isMessageReceived) {
    const accountIds = cfg["accountIds"];
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "trigger.config.accountIds",
        code: "REQUIRED",
        message:
          "At least one channel account is required for the trigger.",
      });
    }
  }

  return errors;
}

function validateConfigArray(
  config: Record<string, unknown>,
  field: string,
  allowed: string[],
  ctx: TriggerContext,
): ValidationError[] {
  const value = config[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    return [
      {
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: `trigger.config.${field}`,
        code: "INVALID_VALUE",
        message: `${field} must be an array.`,
      },
    ];
  }
  const errors: ValidationError[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "string" || !allowed.includes(item)) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: `trigger.config.${field}[${i}]`,
        code: "INVALID_ENUM",
        message: `${field} item must be one of ${allowed.join(", ")}.`,
      });
    }
  }
  return errors;
}

function validateStringArray(
  config: Record<string, unknown>,
  field: string,
  ctx: TriggerContext,
): ValidationError[] {
  const value = config[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    return [
      {
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: `trigger.config.${field}`,
        code: "INVALID_VALUE",
        message: `${field} must be an array.`,
      },
    ];
  }
  const errors: ValidationError[] = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: `trigger.config.${field}[${i}]`,
        code: "INVALID_VALUE",
        message: `${field} item must be a string.`,
      });
    }
  }
  return errors;
}
