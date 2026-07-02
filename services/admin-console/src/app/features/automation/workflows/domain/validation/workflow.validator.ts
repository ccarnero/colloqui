/**
 * Entry point that orchestrates pre-save validation for a workflow flow.
 *
 * Strategy:
 *   1. Validate top-level fields (name, application).
 *   2. Validate graph structure (connections, orphans, cycles, trigger uniqueness).
 *   3. If an inbound channel node exists, validate the derived trigger object.
 *   4. Validate each non-inbound node by building its single action and running
 *      the per-activity validator. Branch nodes are checked via outgoing edges.
 *   5. Run the serializer to ensure the resulting `actions` array is non-empty.
 *
 * This per-node walk keeps every error tied to a visual node key so the
 * dialog can highlight nodes on the canvas.
 */

import { serializeFlow } from "../flow-serializer";
import {
  type ConditionComparator,
  EWorkflowNodeType,
  type IConditionalBranchConfig,
  type IWorkflowFlow,
  type IWorkflowNode,
} from "../workflow-node.types";
import { SOURCE_ACCOUNT_TEMPLATE } from "../workflow-node-defaults";
import { validateAction } from "./action-validators";
import { validateGraph } from "./graph.validator";
import { validateTrigger } from "./trigger.validator";
import {
  type ValidationError,
  type ValidationResult,
  WORKFLOW_APPLICATION_MAX,
  WORKFLOW_NAME_MAX,
} from "./validation.types";

interface SingleAction {
  activity: string;
  name: string;
  args?: Record<string, unknown>;
}

export function validateWorkflow(flow: IWorkflowFlow): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  errors.push(...validateTopLevel(flow));
  errors.push(...validateGraph(flow));

  const outgoingCounts = buildOutgoingCounts(flow);
  const inbound = findInboundChannelNode(flow.nodes);

  errors.push(...validateTriggerPresence(flow, inbound, outgoingCounts));

  if (inbound) {
    const trigger = buildTriggerFromNode(inbound);
    errors.push(
      ...validateTrigger(trigger, {
        nodeKey: inbound.key,
        nodeName: inbound.name,
      })
    );
    errors.push(...validateInboundDirectExtras(inbound));
  }

  const triggerAccountIds = inbound ? extractTriggerAccountIds(inbound) : [];

  for (const node of Object.values(flow.nodes)) {
    if (isInboundChannel(node)) {
      continue;
    }
    errors.push(...validateNode(node, outgoingCounts));
    if (node.type === EWorkflowNodeType.CHANNEL) {
      errors.push(...validateChannelDirection(node));
      if (node.configuration["direction"] === "outbound") {
        warnings.push(
          ...validateOutboundAccountAgainstTrigger(node, triggerAccountIds)
        );
      }
    }
  }

  const serialized = serializeFlow(flow);
  if (serialized.actions.length === 0) {
    errors.push({
      code: "EMPTY_ACTIONS",
      field: "actions",
      message: "Workflow must contain at least one action.",
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * A workflow needs an inbound Channel In to fire. The backend
 * technically allows a missing trigger, but a workflow without one
 * has no entry point — surface it as an error here.
 *
 * Also requires the trigger to have at least one outgoing connection,
 * otherwise it's disconnected from every action in the graph.
 */
function validateTriggerPresence(
  flow: IWorkflowFlow,
  inbound: IWorkflowNode | undefined,
  outgoingCounts: Map<string, number>
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!inbound) {
    const hasAnyNonTriggerNode = Object.values(flow.nodes).some(
      (n) => !isInboundChannel(n)
    );
    if (hasAnyNonTriggerNode) {
      errors.push({
        code: "NO_TRIGGER",
        field: "trigger",
        message: "Workflow must start with a Channel In trigger node.",
      });
    }
    return errors;
  }

  if ((outgoingCounts.get(inbound.key) ?? 0) === 0) {
    const hasOtherNodes = Object.values(flow.nodes).some(
      (n) => n.key !== inbound.key
    );
    if (hasOtherNodes) {
      errors.push({
        nodeKey: inbound.key,
        nodeName: inbound.name,
        code: "TRIGGER_DISCONNECTED",
        message: "Trigger must connect to the first action of the workflow.",
      });
    }
  }

  return errors;
}

/**
 * Inbound-specific config sanity (in addition to `validateTrigger`).
 * `mode` must be present in configuration, since the runtime treats
 * "shared" as a default but the user should choose one explicitly.
 */
function validateInboundDirectExtras(node: IWorkflowNode): ValidationError[] {
  const errors: ValidationError[] = [];
  const mode = node.configuration["mode"];
  if (mode === undefined || mode === null || mode === "") {
    errors.push({
      nodeKey: node.key,
      nodeName: node.name,
      field: "trigger.mode",
      code: "REQUIRED",
      message: "Trigger mode is required.",
    });
  }
  return errors;
}

/**
 * Extracts the inbound trigger's accountIds as a clean string list.
 * Used to constrain outbound `channelSend` activities so they only
 * target accounts the workflow is actually listening on.
 */
function extractTriggerAccountIds(node: IWorkflowNode): string[] {
  const ids = node.configuration["accountIds"];
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids.filter((id): id is string => typeof id === "string");
}

/**
 * If the workflow is triggered by `message_received` with a non-empty
 * accountIds list, an outbound `channelSend` targeting an account
 * outside that list gets a WARNING (never an error): it usually means
 * stale config after the user narrowed the trigger, but it is also a
 * legitimate notify pattern — sending on a dedicated output account
 * the trigger deliberately does not listen on. The backend imposes no
 * such restriction, so the save must not be blocked.
 */
function validateOutboundAccountAgainstTrigger(
  node: IWorkflowNode,
  triggerAccountIds: string[]
): ValidationError[] {
  const accountId = node.configuration["accountId"];
  if (typeof accountId !== "string" || accountId.length === 0) {
    // Missing accountId is already flagged by validateChannelSend.
    return [];
  }
  // "Same as incoming message" resolves at runtime to the account that
  // received the message — by definition one the trigger listens on.
  if (accountId === SOURCE_ACCOUNT_TEMPLATE) {
    return [];
  }
  if (triggerAccountIds.length === 0) {
    return [];
  }
  if (triggerAccountIds.includes(accountId)) {
    return [];
  }
  return [
    {
      nodeKey: node.key,
      nodeName: node.name,
      field: "args.accountId",
      code: "INVALID_VALUE",
      message:
        "Channel account is not among the accounts selected on the trigger. " +
        "The send will still run on it — make sure this cross-account " +
        "notify is intentional and not stale configuration.",
    },
  ];
}

/**
 * Any CHANNEL node must declare its direction (inbound|outbound).
 * Without it the serializer can't decide between trigger and
 * channelSend, leading to malformed payloads.
 */
function validateChannelDirection(node: IWorkflowNode): ValidationError[] {
  const direction = node.configuration["direction"];
  if (direction === "inbound" || direction === "outbound") {
    return [];
  }
  return [
    {
      nodeKey: node.key,
      nodeName: node.name,
      field: "configuration.direction",
      code: "REQUIRED",
      message: "Channel direction is required (inbound or outbound).",
    },
  ];
}

function validateTopLevel(flow: IWorkflowFlow): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = flow.name?.trim() ?? "";
  const application = flow.application?.trim() ?? "";

  if (name.length === 0) {
    errors.push({
      field: "name",
      code: "REQUIRED",
      message: "Workflow name is required.",
    });
  } else if (name.length > WORKFLOW_NAME_MAX) {
    errors.push({
      field: "name",
      code: "TOO_LONG",
      message: `Workflow name must be at most ${WORKFLOW_NAME_MAX} characters.`,
    });
  }

  if (application.length === 0) {
    errors.push({
      field: "application",
      code: "REQUIRED",
      message: "Application is required.",
    });
  } else if (application.length > WORKFLOW_APPLICATION_MAX) {
    errors.push({
      field: "application",
      code: "TOO_LONG",
      message: `Application must be at most ${WORKFLOW_APPLICATION_MAX} characters.`,
    });
  }

  return errors;
}

function isInboundChannel(node: IWorkflowNode): boolean {
  return (
    node.type === EWorkflowNodeType.CHANNEL &&
    node.configuration["direction"] === "inbound"
  );
}

function findInboundChannelNode(
  nodes: Record<string, IWorkflowNode>
): IWorkflowNode | undefined {
  return Object.values(nodes).find(isInboundChannel);
}

function buildTriggerFromNode(node: IWorkflowNode): Record<string, unknown> {
  return {
    type: "message_received",
    mode: (node.configuration["mode"] as string) ?? "shared",
    config: {
      accountIds: node.configuration["accountIds"] ?? [],
      channels: node.configuration["channels"] ?? [],
      providers: node.configuration["providers"] ?? [],
      patterns: node.configuration["patterns"] ?? [],
    },
  };
}

function buildOutgoingCounts(flow: IWorkflowFlow): Map<string, number> {
  const counts = new Map<string, number>();
  for (const conn of Object.values(flow.connections)) {
    if (!flow.nodes[conn.source] || !flow.nodes[conn.target]) {
      continue;
    }
    counts.set(conn.source, (counts.get(conn.source) ?? 0) + 1);
  }
  return counts;
}

function validateNode(
  node: IWorkflowNode,
  outgoingCounts: Map<string, number>
): ValidationError[] {
  const ctx = { nodeKey: node.key, nodeName: node.name };

  if (node.type === EWorkflowNodeType.BRANCH) {
    if ((outgoingCounts.get(node.key) ?? 0) === 0) {
      return [
        {
          ...ctx,
          code: "BRANCH_EMPTY",
          message:
            "Branch must have at least one outgoing connection to a path.",
        },
      ];
    }
    return [];
  }

  if (node.type === EWorkflowNodeType.CONDITIONAL) {
    return validateConditionalNode(node, outgoingCounts);
  }

  const action = buildActionForNode(node);
  if (!action) {
    return [
      {
        ...ctx,
        code: "INVALID_VALUE",
        message: `Unsupported node type: ${node.type}.`,
      },
    ];
  }
  return validateAction(action, ctx);
}

const VALID_COMPARATORS: Set<string> = new Set<ConditionComparator>([
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

const VALID_VARIABLE_PREFIXES = [
  "variables.",
  "results.",
  "request.",
  "workflow.",
];

function validateConditionalNode(
  node: IWorkflowNode,
  outgoingCounts: Map<string, number>
): ValidationError[] {
  const ctx = { nodeKey: node.key, nodeName: node.name };
  const errors: ValidationError[] = [];
  const cfg = node.configuration;
  const branches = cfg["branches"];

  if ((outgoingCounts.get(node.key) ?? 0) === 0) {
    return [
      {
        ...ctx,
        code: "CONDITIONAL_NO_BRANCHES",
        message: "Conditional must have at least one outgoing connection.",
      },
    ];
  }

  if (!Array.isArray(branches) || branches.length === 0) {
    return [
      {
        ...ctx,
        code: "CONDITIONAL_NO_BRANCHES",
        message:
          "Conditional must have at least one branch with a valid condition.",
      },
    ];
  }

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i] as IConditionalBranchConfig | undefined;
    if (!branch || typeof branch !== "object") {
      errors.push({
        ...ctx,
        field: `configuration.branches[${i}]`,
        code: "INVALID_VALUE",
        message: `Branch ${i} must be an object with label and condition.`,
      });
      continue;
    }

    if (!branch.label || typeof branch.label !== "string") {
      errors.push({
        ...ctx,
        field: `configuration.branches[${i}].label`,
        code: "REQUIRED",
        message: `Branch ${i} label is required.`,
      });
    }

    const cond = branch.condition;
    if (!cond || typeof cond !== "object") {
      errors.push({
        ...ctx,
        field: `configuration.branches[${i}].condition`,
        code: "REQUIRED",
        message: `Branch ${i} must have a condition.`,
      });
      continue;
    }

    if (
      !cond.variable ||
      typeof cond.variable !== "string" ||
      !VALID_VARIABLE_PREFIXES.some((p) => cond.variable.startsWith(p))
    ) {
      errors.push({
        ...ctx,
        field: `configuration.branches[${i}].condition.variable`,
        code: "CONDITIONAL_INVALID_VARIABLE",
        message: `Branch ${i} variable must start with one of: ${VALID_VARIABLE_PREFIXES.join(", ")}.`,
      });
    }

    if (
      !cond.comparator ||
      typeof cond.comparator !== "string" ||
      !VALID_COMPARATORS.has(cond.comparator)
    ) {
      errors.push({
        ...ctx,
        field: `configuration.branches[${i}].condition.comparator`,
        code: "CONDITIONAL_INVALID_COMPARATOR",
        message: `Branch ${i} has an invalid comparator.`,
      });
    }

    if (typeof cond.value !== "string") {
      errors.push({
        ...ctx,
        field: `configuration.branches[${i}].condition.value`,
        code: "REQUIRED",
        message: `Branch ${i} value is required.`,
      });
    }
  }

  return errors;
}

/**
 * Builds the single-action shape (no branch recursion) that the per-action
 * validator expects. Mirrors `flow-serializer.nodeToAction` field-by-field
 * for the non-branch cases.
 */
function buildActionForNode(node: IWorkflowNode): SingleAction | null {
  const cfg = node.configuration;
  switch (node.type) {
    case EWorkflowNodeType.CHANNEL:
      return {
        activity: "channelSend",
        name: node.name,
        args: {
          accountId: (cfg["accountId"] as string) ?? "",
          channel: (cfg["channel"] as string) ?? "",
          provider: (cfg["provider"] as string) ?? "",
          to: (cfg["to"] as string) ?? "",
          type: (cfg["messageType"] as string) ?? "text",
          text: cfg["text"],
          templateName: cfg["templateName"],
          templateLanguage: cfg["templateLanguage"],
          mediaUrl: cfg["mediaUrl"],
          caption: cfg["caption"],
        },
      };
    case EWorkflowNodeType.JS_FUNCTION:
      return {
        activity: "jsFunction",
        name: node.name,
        args: { code: cfg["code"] ?? "" },
      };
    case EWorkflowNodeType.ENDPOINT_CALL:
      return {
        activity: "endpointCall",
        name: node.name,
        args: {
          method: cfg["method"] ?? "",
          url: cfg["url"] ?? "",
          adapterId: cfg["adapterId"],
          endpointId: cfg["endpointId"],
        },
      };
    case EWorkflowNodeType.SERVICE_CALL:
      return {
        activity: "serviceCall",
        name: node.name,
        args: {
          serviceId: (cfg["serviceId"] as string) ?? "",
          method: (cfg["method"] as string) ?? "",
          path: (cfg["path"] as string) ?? "",
        },
      };
    case EWorkflowNodeType.SERVICE_BUS_CALL:
      return {
        activity: "serviceBusCall",
        name: node.name,
        args: { subject: (cfg["subject"] as string) ?? "" },
      };
    case EWorkflowNodeType.AGENT_CALL:
      return {
        activity: "agentCall",
        name: node.name,
        args: {
          agentId: (cfg["agentId"] as string) ?? "",
          message: (cfg["message"] as string) ?? "",
        },
      };
    default:
      return null;
  }
}
