import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

/** Prevents runaway recursion on malicious branch payloads. */
const MAX_BRANCH_DEPTH = 12;

/**
 * Validates each element matches the `WorkflowAction` discriminated union
 * from `@yoizen/shared` (endpointCall, jsFunction, serviceBusCall, agentCall, branch).
 */
@ValidatorConstraint({ name: "isWorkflowActionArray", async: false })
export class IsWorkflowActionArrayConstraint
  implements ValidatorConstraintInterface
{
  validate(actions: unknown): boolean {
    if (!Array.isArray(actions) || actions.length === 0) {
      return false;
    }
    for (let i = 0; i < actions.length; i++) {
      if (!this.isAction(actions[i], 0)) {
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return (
      "actions must be a non-empty array of WorkflowAction objects " +
      "(activity: endpointCall | mcpCall | jsFunction | serviceBusCall | serviceCall | channelSend | agentCall | branch | conditional)"
    );
  }

  private isAction(x: unknown, depth: number): boolean {
    if (depth > MAX_BRANCH_DEPTH) {
      return false;
    }
    if (typeof x !== "object" || x === null) {
      return false;
    }
    const o = x as Record<string, unknown>;
    const activity = o.activity;
    const name = o.name;
    if (typeof name !== "string" || name.length === 0) {
      return false;
    }

    if (activity === "endpointCall") {
      return this.isEndpointArgs(o.args);
    }
    if (activity === "mcpCall") {
      return this.isMcpCallArgs(o.args);
    }
    if (activity === "jsFunction") {
      return this.isJsArgs(o.args);
    }
    if (activity === "serviceBusCall") {
      return this.isBusArgs(o.args);
    }
    if (activity === "serviceCall") {
      return this.isServiceCallArgs(o.args);
    }
    if (activity === "channelSend") {
      return this.isChannelSendArgs(o.args);
    }
    if (activity === "agentCall") {
      return this.isAgentCallArgs(o.args);
    }
    if (activity === "branch") {
      return this.isBranch(o, depth);
    }
    if (activity === "conditional") {
      return this.isConditional(o, depth);
    }
    return false;
  }

  private isEndpointArgs(args: unknown): boolean {
    if (typeof args !== "object" || args === null) {
      return false;
    }
    const a = args as Record<string, unknown>;
    return typeof a.method === "string" && typeof a.url === "string";
  }

  private isMcpCallArgs(args: unknown): boolean {
    if (typeof args !== "object" || args === null) {
      return false;
    }
    const a = args as Record<string, unknown>;
    return (
      typeof a.serverId === "string" &&
      a.serverId.length > 0 &&
      typeof a.toolName === "string" &&
      a.toolName.length > 0
    );
  }

  private isJsArgs(args: unknown): boolean {
    if (typeof args !== "object" || args === null) {
      return false;
    }
    const a = args as Record<string, unknown>;
    return typeof a.code === "string";
  }

  private isBusArgs(args: unknown): boolean {
    if (typeof args !== "object" || args === null) {
      return false;
    }
    const a = args as Record<string, unknown>;
    return typeof a.subject === "string";
  }

  private isServiceCallArgs(args: unknown): boolean {
    if (typeof args !== "object" || args === null) {
      return false;
    }
    const a = args as Record<string, unknown>;
    return (
      typeof a.serviceId === "string" &&
      typeof a.method === "string" &&
      typeof a.path === "string"
    );
  }

  private isChannelSendArgs(args: unknown): boolean {
    if (typeof args !== "object" || args === null) {
      return false;
    }
    const a = args as Record<string, unknown>;
    return (
      typeof a.accountId === "string" &&
      typeof a.channel === "string" &&
      typeof a.provider === "string" &&
      typeof a.to === "string" &&
      typeof a.type === "string"
    );
  }

  private isAgentCallArgs(args: unknown): boolean {
    if (typeof args !== "object" || args === null) {
      return false;
    }
    const a = args as Record<string, unknown>;
    if (
      typeof a.agentId !== "string" ||
      a.agentId.length === 0 ||
      typeof a.message !== "string" ||
      a.message.length === 0
    ) {
      return false;
    }
    if (
      a.conversationId !== undefined &&
      typeof a.conversationId !== "string"
    ) {
      return false;
    }
    if (a.customerName !== undefined && typeof a.customerName !== "string") {
      return false;
    }
    if (a.userId !== undefined && typeof a.userId !== "string") {
      return false;
    }
    if (a.channel !== undefined && typeof a.channel !== "string") {
      return false;
    }
    if (a.context !== undefined) {
      if (!Array.isArray(a.context)) {
        return false;
      }
      for (let i = 0; i < a.context.length; i++) {
        const e = a.context[i];
        if (typeof e !== "object" || e === null) {
          return false;
        }
        const row = e as Record<string, unknown>;
        if (
          (row.sender !== "customer" && row.sender !== "agent") ||
          typeof row.content !== "string"
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private isBranch(o: Record<string, unknown>, depth: number): boolean {
    const keys = Object.keys(o);
    let branchCount = 0;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "activity" || key === "name") {
        continue;
      }
      const v = o[key];
      if (!Array.isArray(v) || v.length === 0) {
        return false;
      }
      for (let j = 0; j < v.length; j++) {
        if (!this.isAction(v[j], depth + 1)) {
          return false;
        }
      }
      branchCount++;
    }
    return branchCount > 0;
  }

  private isConditional(o: Record<string, unknown>, depth: number): boolean {
    const branches = o.branches;
    if (!Array.isArray(branches) || branches.length === 0) {
      return false;
    }
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i];
      if (typeof branch !== "object" || branch === null) {
        return false;
      }
      const b = branch as Record<string, unknown>;
      if (typeof b.label !== "string" || b.label.length === 0) {
        return false;
      }
      const cond = b.condition;
      if (typeof cond !== "object" || cond === null) {
        return false;
      }
      const c = cond as Record<string, unknown>;
      if (typeof c.variable !== "string" || c.variable.length === 0) {
        return false;
      }
      if (typeof c.comparator !== "string" || c.comparator.length === 0) {
        return false;
      }
      if (typeof c.value !== "string") {
        return false;
      }
      const actions = b.actions;
      if (!Array.isArray(actions)) {
        return false;
      }
      for (let j = 0; j < actions.length; j++) {
        if (!this.isAction(actions[j], depth + 1)) {
          return false;
        }
      }
    }
    const def = o.default;
    if (def !== undefined) {
      if (!Array.isArray(def)) {
        return false;
      }
      for (let j = 0; j < def.length; j++) {
        if (!this.isAction(def[j], depth + 1)) {
          return false;
        }
      }
    }
    return true;
  }
}
