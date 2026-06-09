/**
 * Per-activity validators for the workflow builder.
 *
 * Operates on the post-serialization shape (`flow-serializer.ts`):
 * each action is `{ activity, name, args }`, except `branch` which
 * spreads dynamic path keys at the top level. We mirror the backend
 * `IsWorkflowActionArrayConstraint` rules exactly, with one
 * UX-driven exception for `endpointCall`:
 *
 *   - Without `adapterId`: require `method` + `url` (URL ad-hoc mode).
 *   - With `adapterId`:    require `endpointId` (adapter mode).
 *     The serializer auto-fills `method`/`url` from the adapter
 *     endpoint when one is selected, so the backend still receives
 *     valid strings.
 */

import {
  MAX_BRANCH_DEPTH,
  type ValidationError,
} from "./validation.types";

interface ActionLike {
  activity?: unknown;
  name?: unknown;
  args?: unknown;
  [key: string]: unknown;
}

interface ValidationContext {
  /** Optional visual node key that produced this action (for UI mapping). */
  nodeKey?: string;
  /** Display name for the dialog (falls back to `action.name`). */
  nodeName?: string;
}

const NON_EMPTY_STRING = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Validates a single serialized action. Returns an array of errors;
 * an empty array means the action is valid.
 */
export function validateAction(
  action: unknown,
  ctx: ValidationContext = {},
  depth = 0,
): ValidationError[] {
  if (depth > MAX_BRANCH_DEPTH) {
    return [
      {
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        code: "MAX_DEPTH_EXCEEDED",
        message: `Branch nesting exceeds the maximum depth of ${MAX_BRANCH_DEPTH}.`,
      },
    ];
  }

  if (typeof action !== "object" || action === null) {
    return [
      {
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        code: "INVALID_VALUE",
        message: "Action must be an object.",
      },
    ];
  }

  const a = action as ActionLike;
  const errors: ValidationError[] = [];

  if (!NON_EMPTY_STRING(a.name)) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "name",
      code: "REQUIRED",
      message: "Action name is required.",
    });
  }

  const displayName = ctx.nodeName ?? (NON_EMPTY_STRING(a.name) ? a.name : undefined);
  const childCtx: ValidationContext = { ...ctx, nodeName: displayName };

  switch (a.activity) {
    case "jsFunction":
      errors.push(...validateJsFunction(a.args, childCtx));
      break;
    case "endpointCall":
      errors.push(...validateEndpointCall(a.args, childCtx));
      break;
    case "serviceCall":
      errors.push(...validateServiceCall(a.args, childCtx));
      break;
    case "serviceBusCall":
      errors.push(...validateServiceBusCall(a.args, childCtx));
      break;
    case "channelSend":
      errors.push(...validateChannelSend(a.args, childCtx));
      break;
    case "agentCall":
      errors.push(...validateAgentCall(a.args, childCtx));
      break;
    case "branch":
      errors.push(...validateBranch(a, childCtx, depth));
      break;
    case "conditional":
      errors.push(...validateConditional(a, childCtx, depth));
      break;
    default:
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: displayName,
        field: "activity",
        code: "INVALID_ENUM",
        message: `Unknown activity type: ${String(a.activity)}.`,
      });
  }

  return errors;
}

function asArgsObject(args: unknown): Record<string, unknown> | null {
  if (typeof args !== "object" || args === null) {
    return null;
  }
  return args as Record<string, unknown>;
}

function missingArgsError(ctx: ValidationContext): ValidationError {
  return {
    nodeKey: ctx.nodeKey,
    nodeName: ctx.nodeName,
    field: "args",
    code: "REQUIRED",
    message: "Action args are required.",
  };
}

function validateJsFunction(
  args: unknown,
  ctx: ValidationContext,
): ValidationError[] {
  const a = asArgsObject(args);
  if (!a) return [missingArgsError(ctx)];

  if (!NON_EMPTY_STRING(a["code"])) {
    return [
      {
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "args.code",
        code: "REQUIRED",
        message: "JavaScript code is required.",
      },
    ];
  }
  return [];
}

/**
 * `endpointCall` has two modes driven by the UI:
 *   - Adapter mode (`adapterId` truthy): require `endpointId`.
 *   - URL ad-hoc mode (no `adapterId`): require `method` + `url`.
 *
 * This is the only deliberate deviation from the backend's
 * "method + url required as strings" rule.
 */
function validateEndpointCall(
  args: unknown,
  ctx: ValidationContext,
): ValidationError[] {
  const a = asArgsObject(args);
  if (!a) return [missingArgsError(ctx)];

  const errors: ValidationError[] = [];
  const hasAdapter = NON_EMPTY_STRING(a["adapterId"]);

  if (hasAdapter) {
    if (!NON_EMPTY_STRING(a["endpointId"])) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "args.endpointId",
        code: "REQUIRED",
        message: "Endpoint is required when an adapter is selected.",
      });
    }
    return errors;
  }

  if (!NON_EMPTY_STRING(a["method"])) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "args.method",
      code: "REQUIRED",
      message: "HTTP method is required.",
    });
  } else if (!HTTP_METHODS.includes(a["method"] as string)) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "args.method",
      code: "INVALID_ENUM",
      message: `HTTP method must be one of ${HTTP_METHODS.join(", ")}.`,
    });
  }
  if (!NON_EMPTY_STRING(a["url"])) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "args.url",
      code: "REQUIRED",
      message: "URL is required.",
    });
  }
  return errors;
}

function validateServiceCall(
  args: unknown,
  ctx: ValidationContext,
): ValidationError[] {
  const a = asArgsObject(args);
  if (!a) return [missingArgsError(ctx)];

  const errors: ValidationError[] = [];
  if (!NON_EMPTY_STRING(a["serviceId"])) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "args.serviceId",
      code: "REQUIRED",
      message: "Service is required.",
    });
  }
  if (!NON_EMPTY_STRING(a["method"])) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "args.method",
      code: "REQUIRED",
      message: "HTTP method is required.",
    });
  }
  if (!NON_EMPTY_STRING(a["path"])) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "args.path",
      code: "REQUIRED",
      message: "Path is required.",
    });
  }
  return errors;
}

function validateServiceBusCall(
  args: unknown,
  ctx: ValidationContext,
): ValidationError[] {
  const a = asArgsObject(args);
  if (!a) return [missingArgsError(ctx)];

  if (!NON_EMPTY_STRING(a["subject"])) {
    return [
      {
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "args.subject",
        code: "REQUIRED",
        message: "NATS subject is required.",
      },
    ];
  }
  return [];
}

function validateChannelSend(
  args: unknown,
  ctx: ValidationContext,
): ValidationError[] {
  const a = asArgsObject(args);
  if (!a) return [missingArgsError(ctx)];

  const required: Array<{ key: string; label: string }> = [
    { key: "accountId", label: "Channel account" },
    { key: "channel", label: "Channel" },
    { key: "provider", label: "Provider" },
    { key: "to", label: "Recipient" },
    { key: "type", label: "Message type" },
  ];

  const errors: ValidationError[] = [];
  for (const { key, label } of required) {
    if (!NON_EMPTY_STRING(a[key])) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: `args.${key}`,
        code: "REQUIRED",
        message: `${label} is required.`,
      });
    }
  }

  errors.push(...validateChannelSendByType(a, ctx));
  return errors;
}

/**
 * Conditional fields driven by `type`:
 *   - text:           `text` is required.
 *   - template:       `templateName` AND `templateLanguage` are required.
 *   - image | document: `mediaUrl` is required.
 *
 * The backend currently doesn't enforce these (the 5 base fields are
 * the only required ones), but a message of `type=text` with an empty
 * `text` will fail at runtime — surface it pre-save instead.
 */
function validateChannelSendByType(
  args: Record<string, unknown>,
  ctx: ValidationContext,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const type = args["type"];

  if (type === "text") {
    if (!NON_EMPTY_STRING(args["text"])) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "args.text",
        code: "REQUIRED",
        message: "Message text is required.",
      });
    }
    return errors;
  }

  if (type === "template") {
    if (!NON_EMPTY_STRING(args["templateName"])) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "args.templateName",
        code: "REQUIRED",
        message: "Template name is required.",
      });
    }
    if (!NON_EMPTY_STRING(args["templateLanguage"])) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "args.templateLanguage",
        code: "REQUIRED",
        message: "Template language is required.",
      });
    }
    return errors;
  }

  if (type === "image" || type === "document") {
    if (!NON_EMPTY_STRING(args["mediaUrl"])) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "args.mediaUrl",
        code: "REQUIRED",
        message: "Media URL is required.",
      });
    }
  }

  return errors;
}

function validateAgentCall(
  args: unknown,
  ctx: ValidationContext,
): ValidationError[] {
  const a = asArgsObject(args);
  if (!a) return [missingArgsError(ctx)];

  const errors: ValidationError[] = [];
  if (!NON_EMPTY_STRING(a["agentId"])) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "args.agentId",
      code: "REQUIRED",
      message: "Agent is required.",
    });
  }
  if (!NON_EMPTY_STRING(a["message"])) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      field: "args.message",
      code: "REQUIRED",
      message: "Agent message is required.",
    });
  }

  const context = a["context"];
  if (context !== undefined) {
    if (!Array.isArray(context)) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: "args.context",
        code: "INVALID_VALUE",
        message: "Agent context must be an array.",
      });
    } else {
      for (let i = 0; i < context.length; i++) {
        const entry = context[i];
        if (typeof entry !== "object" || entry === null) {
          errors.push({
            nodeKey: ctx.nodeKey,
            nodeName: ctx.nodeName,
            field: `args.context[${i}]`,
            code: "INVALID_VALUE",
            message: "Each context entry must be an object.",
          });
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (e["sender"] !== "customer" && e["sender"] !== "agent") {
          errors.push({
            nodeKey: ctx.nodeKey,
            nodeName: ctx.nodeName,
            field: `args.context[${i}].sender`,
            code: "INVALID_ENUM",
            message: "Context sender must be 'customer' or 'agent'.",
          });
        }
        if (typeof e["content"] !== "string") {
          errors.push({
            nodeKey: ctx.nodeKey,
            nodeName: ctx.nodeName,
            field: `args.context[${i}].content`,
            code: "REQUIRED",
            message: "Context entry content is required.",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Branch action: at least one dynamic path key with a non-empty
 * array of valid actions. Recurses with depth +1.
 */
function validateBranch(
  action: ActionLike,
  ctx: ValidationContext,
  depth: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const reservedKeys = new Set(["activity", "name", "args"]);
  const pathKeys = Object.keys(action).filter(
    (k) => !reservedKeys.has(k),
  );

  let nonEmptyPaths = 0;
  for (const key of pathKeys) {
    const value = action[key];
    if (!Array.isArray(value)) continue;
    if (value.length === 0) continue;
    nonEmptyPaths++;
    for (let i = 0; i < value.length; i++) {
      errors.push(
        ...validateAction(value[i], ctx, depth + 1).map((err) => ({
          ...err,
          field: err.field
            ? `${key}[${i}].${err.field}`
            : `${key}[${i}]`,
        })),
      );
    }
  }

  if (nonEmptyPaths === 0) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      code: "BRANCH_EMPTY",
      message: "Branch must have at least one path with one or more actions.",
    });
  }

  return errors;
}

const CONDITIONAL_COMPARATORS = new Set([
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "contains",
  "exists",
  "notExists",
]);

/**
 * Conditional action: at least one branch with a valid condition.
 * Each branch's actions array is recursively validated with depth +1.
 * The optional `default` array is also validated if present.
 */
function validateConditional(
  action: ActionLike,
  ctx: ValidationContext,
  depth: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const branches = action["branches"];

  if (!Array.isArray(branches) || branches.length === 0) {
    errors.push({
      nodeKey: ctx.nodeKey,
      nodeName: ctx.nodeName,
      code: "CONDITIONAL_NO_BRANCHES",
      message: "Conditional must have at least one branch.",
    });
    return errors;
  }

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    if (typeof branch !== "object" || branch === null) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: `branches[${i}]`,
        code: "INVALID_VALUE",
        message: `Branch ${i} must be an object.`,
      });
      continue;
    }
    const b = branch as Record<string, unknown>;

    if (!NON_EMPTY_STRING(b["label"])) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: `branches[${i}].label`,
        code: "REQUIRED",
        message: `Branch ${i} label is required.`,
      });
    }

    const cond = b["condition"];
    if (typeof cond !== "object" || cond === null) {
      errors.push({
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        field: `branches[${i}].condition`,
        code: "REQUIRED",
        message: `Branch ${i} must have a condition.`,
      });
    } else {
      const c = cond as Record<string, unknown>;
      if (!NON_EMPTY_STRING(c["variable"])) {
        errors.push({
          nodeKey: ctx.nodeKey,
          nodeName: ctx.nodeName,
          field: `branches[${i}].condition.variable`,
          code: "REQUIRED",
          message: `Branch ${i} variable is required.`,
        });
      }
      if (
        typeof c["comparator"] !== "string" ||
        !CONDITIONAL_COMPARATORS.has(c["comparator"])
      ) {
        errors.push({
          nodeKey: ctx.nodeKey,
          nodeName: ctx.nodeName,
          field: `branches[${i}].condition.comparator`,
          code: "CONDITIONAL_INVALID_COMPARATOR",
          message: `Branch ${i} has an invalid comparator.`,
        });
      }
      if (typeof c["value"] !== "string") {
        errors.push({
          nodeKey: ctx.nodeKey,
          nodeName: ctx.nodeName,
          field: `branches[${i}].condition.value`,
          code: "REQUIRED",
          message: `Branch ${i} value is required.`,
        });
      }
    }

    const branchActions = b["actions"];
    if (Array.isArray(branchActions) && branchActions.length > 0) {
      for (let j = 0; j < branchActions.length; j++) {
        errors.push(
          ...validateAction(branchActions[j], ctx, depth + 1).map(
            (err) => ({
              ...err,
              field: err.field
                ? `branches[${i}].actions[${j}].${err.field}`
                : `branches[${i}].actions[${j}]`,
            }),
          ),
        );
      }
    }
  }

  const defaultActions = action["default"];
  if (Array.isArray(defaultActions) && defaultActions.length > 0) {
    for (let j = 0; j < defaultActions.length; j++) {
      errors.push(
        ...validateAction(defaultActions[j], ctx, depth + 1).map(
          (err) => ({
            ...err,
            field: err.field
              ? `default[${j}].${err.field}`
              : `default[${j}]`,
          }),
        ),
      );
    }
  }

  return errors;
}
