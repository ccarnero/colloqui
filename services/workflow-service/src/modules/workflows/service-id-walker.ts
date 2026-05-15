import type {
    BranchAction,
    ServiceCallAction,
    WorkflowAction,
  } from "@yoizen/shared";
  
  /**
   * Walks the action tree (including nested `branch` action arms) once
   * and returns the unique set of `serviceId`s used by `serviceCall`
   * actions. Linear in the total number of action nodes; the `Set`
   * keeps duplicate-collection at O(1) per insert.
   *
   * Public so unit tests can assert collection on representative trees
   * without spinning the resolver.
   */
  export function collectServiceIds(
    actions: WorkflowAction[],
    out: Set<string> = new Set<string>(),
  ): Set<string> {
    for (let i = 0, len = actions.length; i < len; i++) {
      const action = actions[i]!;
      if (action.activity === "serviceCall") {
        const id = action.args.serviceId;
        if (typeof id === "string" && id.length > 0) {
          out.add(id);
        }
        continue;
      }
      if (action.activity === "branch") {
        collectFromBranch(action, out);
      }
    }
    return out;
  }
  
  /**
   * Returns a deep clone of `actions` where every `serviceCall` whose
   * `serviceId` resolves through `slugMap` has its args augmented with
   * `serviceSlug`. Actions whose UUID was not resolved (registry miss
   * or down) are left untouched and the activity falls back to the
   * legacy registry path — backwards-compat with existing definitions.
   *
   * Arrays and plain objects are cloned shallowly; primitives and
   * unrelated branches are shared by reference for O(1) memory cost
   * on large definitions.
   */
  export function augmentActionsWithSlug(
    actions: WorkflowAction[],
    slugMap: Map<string, string>,
  ): WorkflowAction[] {
    if (slugMap.size === 0) return actions;
  
    const out: WorkflowAction[] = new Array(actions.length);
    for (let i = 0, len = actions.length; i < len; i++) {
      out[i] = augmentSingle(actions[i]!, slugMap);
    }
    return out;
  }
  
  function augmentSingle(
    action: WorkflowAction,
    slugMap: Map<string, string>,
  ): WorkflowAction {
    if (action.activity === "serviceCall") {
      return augmentServiceCall(action, slugMap);
    }
    if (action.activity === "branch") {
      return augmentBranch(action, slugMap);
    }
    return action;
  }
  
  function augmentServiceCall(
    action: ServiceCallAction,
    slugMap: Map<string, string>,
  ): ServiceCallAction {
    const slug = slugMap.get(action.args.serviceId);
    if (!slug) return action;
    if (action.args.serviceSlug === slug) return action;
    return {
      ...action,
      args: { ...action.args, serviceSlug: slug },
    };
  }
  
  function augmentBranch(
    action: BranchAction,
    slugMap: Map<string, string>,
  ): BranchAction {
    const cloned: BranchAction = {
      activity: "branch",
      name: action.name,
    };
    for (const key of Object.keys(action)) {
      if (key === "activity" || key === "name") continue;
      const value = action[key];
      if (Array.isArray(value)) {
        cloned[key] = augmentActionsWithSlug(value, slugMap);
      } else if (typeof value === "string") {
        cloned[key] = value;
      }
    }
    return cloned;
  }
  
  function collectFromBranch(action: BranchAction, out: Set<string>): void {
    for (const key of Object.keys(action)) {
      if (key === "activity" || key === "name") continue;
      const value = action[key];
      if (Array.isArray(value)) {
        collectServiceIds(value, out);
      }
    }
  }
  