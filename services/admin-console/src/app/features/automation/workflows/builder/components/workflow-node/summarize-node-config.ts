import {
  EWorkflowNodeType,
  type IConditionalBranchConfig,
  type IWorkflowNode,
} from "../../../domain/workflow-node.types";

const MAX_SUMMARY_LENGTH = 40;

/** Truncates a string to `MAX_SUMMARY_LENGTH`, appending an ellipsis when cut. */
function truncate(value: string, max: number = MAX_SUMMARY_LENGTH): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Joins non-empty parts with " · ", dropping blanks — no invented placeholders. */
function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(" · ");
}

function summarizeChannel(configuration: Record<string, unknown>): string {
  const direction =
    typeof configuration["direction"] === "string"
      ? (configuration["direction"] as string)
      : "";

  let identity = "";
  if (direction === "inbound") {
    const channels = configuration["channels"];
    if (Array.isArray(channels)) {
      identity = channels.filter((c) => typeof c === "string" && c).join(", ");
    }
  } else {
    const channel = configuration["channel"];
    if (typeof channel === "string" && channel) {
      identity = channel;
    }
  }

  return joinParts([direction, identity]);
}

function summarizeJsFunction(configuration: Record<string, unknown>): string {
  const code = configuration["code"];
  if (typeof code !== "string" || code.trim().length === 0) {
    return "";
  }
  const match = code.match(/function\s+([A-Za-z0-9_$]+)/);
  const fnName = match ? match[1] : "fn";
  const lineCount = code.split("\n").length;
  return `${fnName}() · ${lineCount} line${lineCount === 1 ? "" : "s"}`;
}

function summarizeHttpCall(configuration: Record<string, unknown>): string {
  const method =
    typeof configuration["method"] === "string"
      ? (configuration["method"] as string)
      : "";
  const url = configuration["url"];
  if (typeof url !== "string" || url.trim().length === 0) {
    return method ? method : "";
  }
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {
    // Not a parseable absolute URL (e.g. a template placeholder) — show it
    // verbatim rather than inventing a host.
  }
  return joinParts([method, host]);
}

function summarizeMcpCall(configuration: Record<string, unknown>): string {
  const serverId =
    typeof configuration["serverId"] === "string"
      ? (configuration["serverId"] as string)
      : "";
  const toolName =
    typeof configuration["toolName"] === "string"
      ? (configuration["toolName"] as string)
      : "";
  return joinParts([serverId, toolName]);
}

function summarizeServiceCall(configuration: Record<string, unknown>): string {
  const serviceId = configuration["serviceId"];
  if (typeof serviceId !== "string" || serviceId.trim().length === 0) {
    return "";
  }
  const method =
    typeof configuration["method"] === "string"
      ? (configuration["method"] as string)
      : "";
  const path =
    typeof configuration["path"] === "string"
      ? (configuration["path"] as string)
      : "";
  return joinParts([method, path]);
}

function summarizeServiceBusCall(
  configuration: Record<string, unknown>
): string {
  const subject = configuration["subject"];
  return typeof subject === "string" ? subject.trim() : "";
}

function summarizeAgentCall(configuration: Record<string, unknown>): string {
  const agentId = configuration["agentId"];
  return typeof agentId === "string" ? agentId.trim() : "";
}

function summarizeBranch(configuration: Record<string, unknown>): string {
  const branches = configuration["branches"];
  if (!Array.isArray(branches) || branches.length === 0) {
    return "";
  }
  return `${branches.length} path${branches.length === 1 ? "" : "s"}`;
}

function summarizeConditional(configuration: Record<string, unknown>): string {
  const branches = configuration["branches"];
  if (!Array.isArray(branches) || branches.length === 0) {
    return "";
  }
  const [first, ...rest] = branches as IConditionalBranchConfig[];
  const condition = first?.condition;
  if (!condition) {
    return "";
  }
  const expression = truncate(
    `${condition.variable} ${condition.comparator} ${condition.value}`
  );
  return rest.length > 0 ? `${expression} +${rest.length} more` : expression;
}

/**
 * Derives the node card's one-line mono config summary (SPEC T03) purely
 * from EXISTING per-type configuration fields — nothing invented. Returns
 * an empty string when the node has nothing meaningful to summarize yet
 * (fresh/blank config), matching the mock's config-summary line while
 * never fabricating placeholder text.
 */
export function summarizeNodeConfig(node: IWorkflowNode): string {
  const configuration = node.configuration;
  switch (node.type) {
    case EWorkflowNodeType.CHANNEL:
      return summarizeChannel(configuration);
    case EWorkflowNodeType.JS_FUNCTION:
      return summarizeJsFunction(configuration);
    case EWorkflowNodeType.ENDPOINT_CALL:
      return summarizeHttpCall(configuration);
    case EWorkflowNodeType.MCP_CALL:
      return summarizeMcpCall(configuration);
    case EWorkflowNodeType.SERVICE_CALL:
      return summarizeServiceCall(configuration);
    case EWorkflowNodeType.SERVICE_BUS_CALL:
      return summarizeServiceBusCall(configuration);
    case EWorkflowNodeType.AGENT_CALL:
      return summarizeAgentCall(configuration);
    case EWorkflowNodeType.BRANCH:
      return summarizeBranch(configuration);
    case EWorkflowNodeType.CONDITIONAL:
      return summarizeConditional(configuration);
    default:
      return "";
  }
}
