import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

/** Prevents runaway recursion on malicious branch payloads. */
const MAX_BRANCH_DEPTH = 12;

/**
 * Validates each element matches the `WorkflowAction` discriminated union
 * from `@yoizen/shared` (endpointCall, jsFunction, serviceBusCall, branch).
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
      "(activity: endpointCall | jsFunction | serviceBusCall | serviceCall | branch)"
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
    if (activity === "jsFunction") {
      return this.isJsArgs(o.args);
    }
    if (activity === "serviceBusCall") {
      return this.isBusArgs(o.args);
    }
    if (activity === "serviceCall") {
      return this.isServiceCallArgs(o.args);
    }
    if (activity === "branch") {
      return this.isBranch(o, depth);
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
}
