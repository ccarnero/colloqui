import { describe, expect, it } from "vitest";
import type {
  IRunEvent,
  IRunSpan,
} from "../../../../../core/services/run-view.service";
import { layoutRun } from "../layout-run";
import { mergeRun } from "../merge-run";
import type {
  IActionStep,
  IConditionalStep,
  IForkStep,
} from "../run-view.model";

function event(overrides: Partial<IRunEvent>): IRunEvent {
  return {
    event_id: "evt-1",
    subject: "s",
    tenant: "tenant-a",
    producer: "workflow-service",
    domain: "workflow",
    kind: "action_started",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: "started-1",
    causation_depth: 1,
    occurred_at: "2026-07-11T10:00:00.000Z",
    tech: "platform",
    business_fn: "workflow-execution",
    rule: 19,
    consumed_by: [],
    is_claim_check: false,
    compliance: "full",
    workflow_id: "exec-1",
    run_id: null,
    connector_id: null,
    cache_status: null,
    has_envelope: true,
    payload_connector_id: null,
    payload_agent_id: null,
    payload_step_status: null,
    payload_execution_id: "exec-1",
    payload_action_index: null,
    payload_action_type: null,
    payload_action_name: null,
    payload_branch: null,
    payload_expression: null,
    payload_evaluated_value: null,
    payload_branch_taken: null,
    payload_cases: null,
    ...overrides,
  };
}

function span(overrides: Partial<IRunSpan>): IRunSpan {
  return {
    event_id: "evt-1",
    causation_id: "started-1",
    kind_prefix: "action",
    entity_id: "exec-1",
    started_at: "2026-07-11T10:00:00.000Z",
    completed_at: "2026-07-11T10:00:00.100Z",
    duration_ms: 100,
    ...overrides,
  };
}

/** One action_started/action_completed pair for a step at
 * `(branch, actionIndex)`, plus the matching span keyed off the started
 * event's own `event_id` (mirrors `merge-run.ts`'s span-matching rule). */
function actionEvents(args: {
  actionIndex: number;
  actionType: string;
  actionName: string;
  branch?: string;
  status?: "ok" | "failed";
  connectorId?: string;
  agentId?: string;
  durationMs?: number;
}): { events: IRunEvent[]; spans: IRunSpan[] } {
  const startedId = `${args.branch ?? "root"}-${args.actionIndex}-started`;
  const completedId = `${args.branch ?? "root"}-${args.actionIndex}-completed`;
  const started = event({
    event_id: startedId,
    kind: "action_started",
    payload_action_index: args.actionIndex,
    payload_action_type: args.actionType,
    payload_action_name: args.actionName,
    payload_branch: args.branch ?? null,
    payload_connector_id: args.connectorId ?? null,
    payload_agent_id: args.agentId ?? null,
  });
  const completed = event({
    event_id: completedId,
    kind: "action_completed",
    payload_action_index: args.actionIndex,
    payload_action_type: args.actionType,
    payload_action_name: args.actionName,
    payload_branch: args.branch ?? null,
    payload_connector_id: args.connectorId ?? null,
    payload_agent_id: args.agentId ?? null,
    payload_step_status: args.status ?? "ok",
  });
  const durationMs = args.durationMs ?? 100;
  return {
    events: [started, completed],
    spans: [
      span({
        event_id: startedId,
        started_at: "2026-07-11T10:00:00.000Z",
        completed_at: new Date(1752227200000 + durationMs).toISOString(),
        duration_ms: durationMs,
      }),
    ],
  };
}

function conditionEvent(args: {
  actionIndex: number;
  expression: string;
  evaluatedValue: string;
  branchTaken: string | null;
  cases: string[];
}): IRunEvent {
  return event({
    event_id: `cond-${args.actionIndex}-${args.branchTaken ?? "none"}`,
    kind: "condition_evaluated",
    payload_action_index: args.actionIndex,
    payload_expression: args.expression,
    payload_evaluated_value: args.evaluatedValue,
    payload_branch_taken: args.branchTaken,
    payload_cases: args.cases,
  });
}

describe("mergeRun", () => {
  it("linear: a single executed action step carries status/timing/instance", () => {
    const { events, spans } = actionEvents({
      actionIndex: 0,
      actionType: "endpointCall",
      actionName: "callOrderApi",
      connectorId: "order-api",
      durationMs: 183,
    });
    const definition = {
      actions: [{ activity: "endpointCall", name: "callOrderApi", args: {} }],
    };

    const merged = mergeRun(events, spans, definition);
    expect(merged.degraded).toBe(false);
    expect(merged.steps).toHaveLength(1);
    const step = merged.steps[0] as IActionStep;
    expect(step.type).toBe("action");
    expect(step.status).toBe("ok");
    expect(step.instanceId).toBe("order-api");
    expect(step.durationMs).toBe(183);
    expect(step.color).toBe("platform");
  });

  it("linear: a failed action carries status 'failed'", () => {
    const { events, spans } = actionEvents({
      actionIndex: 0,
      actionType: "endpointCall",
      actionName: "callOrderApi",
      status: "failed",
    });
    const definition = {
      actions: [{ activity: "endpointCall", name: "callOrderApi", args: {} }],
    };
    const merged = mergeRun(events, spans, definition);
    expect((merged.steps[0] as IActionStep).status).toBe("failed");
  });

  it("agentCall colors 'agent', channelSend colors 'channel'", () => {
    const { events, spans } = actionEvents({
      actionIndex: 0,
      actionType: "agentCall",
      actionName: "askAgent",
      agentId: "support-agent",
    });
    const definition = {
      actions: [{ activity: "agentCall", name: "askAgent", args: {} }],
    };
    const merged = mergeRun(events, spans, definition);
    const step = merged.steps[0] as IActionStep;
    expect(step.color).toBe("agent");
    expect(step.instanceId).toBe("support-agent");
  });

  it("3-case condition: taken case reports expression/evaluatedValue/branchTaken and marks the matching branch taken", () => {
    const cond = conditionEvent({
      actionIndex: 0,
      expression: "{{order.total}}",
      evaluatedValue: "320",
      branchTaken: "100-500",
      cases: ["<100", "100-500", ">500"],
    });
    const definition = {
      actions: [
        {
          activity: "conditional",
          name: "checkTotal",
          branches: [
            {
              label: "<100",
              condition: {
                variable: "order.total",
                comparator: "lt",
                value: "100",
              },
              actions: [],
            },
            {
              label: "100-500",
              condition: {
                variable: "order.total",
                comparator: "lte",
                value: "500",
              },
              actions: [],
            },
            {
              label: ">500",
              condition: {
                variable: "order.total",
                comparator: "gt",
                value: "500",
              },
              actions: [],
            },
          ],
        },
      ],
    };
    const merged = mergeRun([cond], [], definition);
    const step = merged.steps[0] as IConditionalStep;
    expect(step.type).toBe("conditional");
    expect(step.executed).toBe(true);
    expect(step.expression).toBe("{{order.total}}");
    expect(step.evaluatedValue).toBe("320");
    expect(step.branchTaken).toBe("100-500");
    expect(step.branches.map((b) => [b.label, b.taken])).toEqual([
      ["<100", false],
      ["100-500", true],
      [">500", false],
    ]);
  });

  it("taken/not-taken: only the taken branch's actions get status 'ok'; siblings are 'not_executed'", () => {
    const cond = conditionEvent({
      actionIndex: 0,
      expression: "{{order.total}}",
      evaluatedValue: "320",
      branchTaken: "100-500",
      cases: ["<100", "100-500", ">500"],
    });
    const taken = actionEvents({
      actionIndex: 0,
      actionType: "endpointCall",
      actionName: "applyDiscount",
      branch: "100-500",
    });
    const definition = {
      actions: [
        {
          activity: "conditional",
          name: "checkTotal",
          branches: [
            {
              label: "<100",
              condition: {
                variable: "order.total",
                comparator: "lt",
                value: "100",
              },
              actions: [{ activity: "agentCall", name: "escalate", args: {} }],
            },
            {
              label: "100-500",
              condition: {
                variable: "order.total",
                comparator: "lte",
                value: "500",
              },
              actions: [
                { activity: "endpointCall", name: "applyDiscount", args: {} },
              ],
            },
            {
              label: ">500",
              condition: {
                variable: "order.total",
                comparator: "gt",
                value: "500",
              },
              actions: [
                { activity: "jsFunction", name: "autoReply", args: {} },
              ],
            },
          ],
        },
      ],
    };
    const merged = mergeRun([cond, ...taken.events], taken.spans, definition);
    const step = merged.steps[0] as IConditionalStep;
    const lowBranch = step.branches[0]!;
    const midBranch = step.branches[1]!;
    const highBranch = step.branches[2]!;
    expect((lowBranch.steps[0] as IActionStep).status).toBe("not_executed");
    expect((midBranch.steps[0] as IActionStep).status).toBe("ok");
    expect((highBranch.steps[0] as IActionStep).status).toBe("not_executed");
  });

  it("if-without-else evaluating false: branchTaken is null and no branch is taken", () => {
    const cond = conditionEvent({
      actionIndex: 0,
      expression: "{{vip_customer}}",
      evaluatedValue: "false",
      branchTaken: null,
      cases: ["true"],
    });
    const definition = {
      actions: [
        {
          activity: "conditional",
          name: "vipGate",
          branches: [
            {
              label: "true",
              condition: {
                variable: "vip_customer",
                comparator: "eq",
                value: "true",
              },
              actions: [
                { activity: "jsFunction", name: "notifyManager", args: {} },
              ],
            },
          ],
        },
      ],
    };
    const merged = mergeRun([cond], [], definition);
    const step = merged.steps[0] as IConditionalStep;
    expect(step.executed).toBe(true);
    expect(step.branchTaken).toBeNull();
    expect(step.hasDefault).toBe(false);
    expect(step.branches).toHaveLength(1);
    expect(step.branches[0]!.taken).toBe(false);
    expect((step.branches[0]!.steps[0] as IActionStep).status).toBe(
      "not_executed"
    );
  });

  it("condition with a default branch: unmatched cases fall to 'default'", () => {
    const cond = conditionEvent({
      actionIndex: 0,
      expression: "{{order.total}}",
      evaluatedValue: "5",
      branchTaken: "default",
      cases: [">500"],
    });
    const definition = {
      actions: [
        {
          activity: "conditional",
          name: "checkTotal",
          branches: [
            {
              label: ">500",
              condition: {
                variable: "order.total",
                comparator: "gt",
                value: "500",
              },
              actions: [],
            },
          ],
          default: [{ activity: "jsFunction", name: "noop", args: {} }],
        },
      ],
    };
    const merged = mergeRun([cond], [], definition);
    const step = merged.steps[0] as IConditionalStep;
    expect(step.hasDefault).toBe(true);
    expect(step.branches).toHaveLength(2);
    expect(step.branches[1]!.label).toBe("default");
    expect(step.branches[1]!.taken).toBe(true);
  });

  it("nested if: an inner conditional inside the taken outer branch resolves independently, matched by occurred_at order", () => {
    const outer = conditionEvent({
      actionIndex: 0,
      expression: "{{order.total}}",
      evaluatedValue: "320",
      branchTaken: "100-500",
      cases: ["100-500"],
    });
    const inner = conditionEvent({
      actionIndex: 0, // SAME actionIndex as outer — only distinguishable by occurred_at order (see merge-run.ts header).
      expression: "{{discount_applied}}",
      evaluatedValue: "true",
      branchTaken: "true",
      cases: ["true"],
    });
    const definition = {
      actions: [
        {
          activity: "conditional",
          name: "checkTotal",
          branches: [
            {
              label: "100-500",
              condition: {
                variable: "order.total",
                comparator: "lte",
                value: "500",
              },
              actions: [
                {
                  activity: "conditional",
                  name: "discountGate",
                  branches: [
                    {
                      label: "true",
                      condition: {
                        variable: "discount_applied",
                        comparator: "eq",
                        value: "true",
                      },
                      actions: [
                        { activity: "channelSend", name: "send", args: {} },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    // Events must arrive in occurred_at (array) order: outer before inner.
    const merged = mergeRun([outer, inner], [], definition);
    const outerStep = merged.steps[0] as IConditionalStep;
    expect(outerStep.branchTaken).toBe("100-500");
    const innerStep = outerStep.branches[0]!.steps[0] as IConditionalStep;
    expect(innerStep.type).toBe("conditional");
    expect(innerStep.nestingDepth).toBe(1);
    expect(innerStep.branchTaken).toBe("true");
    expect(innerStep.executed).toBe(true);
    const sendStep = innerStep.branches[0]!.steps[0] as IActionStep;
    expect(sendStep.nestingDepth).toBe(2);
    expect(sendStep.actionType).toBe("channelSend");
    expect(sendStep.color).toBe("channel");
    // Regression: each conditional carries the event_id of the SPECIFIC
    // `condition_evaluated` event it was matched to (queue.shift() order),
    // not just the shared numeric actionIndex — this is what
    // `resolve-step-events.ts` relies on to avoid the nested/root
    // collision bug.
    expect(outerStep.conditionEventId).toBe(outer.event_id);
    expect(innerStep.conditionEventId).toBe(inner.event_id);
    expect(outerStep.conditionEventId).not.toBe(innerStep.conditionEventId);
  });

  it("parallel fork: both lanes execute independently and carry their own steps", () => {
    const forkEvents = actionEvents({
      actionIndex: 0,
      actionType: "branch",
      actionName: "fanOut",
    });
    const laneA = actionEvents({
      actionIndex: 0,
      actionType: "endpointCall",
      actionName: "stockCheck",
      branch: "A",
    });
    const laneB = actionEvents({
      actionIndex: 0,
      actionType: "agentCall",
      actionName: "support",
      branch: "B",
      agentId: "support-agent",
    });
    const definition = {
      actions: [
        {
          activity: "branch",
          name: "fanOut",
          A: [{ activity: "endpointCall", name: "stockCheck", args: {} }],
          B: [{ activity: "agentCall", name: "support", args: {} }],
        },
      ],
    };
    const merged = mergeRun(
      [...forkEvents.events, ...laneA.events, ...laneB.events],
      [...forkEvents.spans, ...laneA.spans, ...laneB.spans],
      definition
    );
    const fork = merged.steps[0] as IForkStep;
    expect(fork.type).toBe("fork");
    expect(fork.lanes).toHaveLength(2);
    expect(fork.lanes[0]!.label).toBe("A");
    expect(fork.lanes[1]!.label).toBe("B");
    expect((fork.lanes[0]!.steps[0] as IActionStep).status).toBe("ok");
    expect((fork.lanes[1]!.steps[0] as IActionStep).status).toBe("ok");
    expect((fork.lanes[1]!.steps[0] as IActionStep).instanceId).toBe(
      "support-agent"
    );
  });

  it("events-only fallback (empty definition): multi-action run produces one flat step per executed action, ordered by occurred_at", () => {
    const first = actionEvents({
      actionIndex: 0,
      actionType: "endpointCall",
      actionName: "callOrderApi",
      connectorId: "order-api",
      durationMs: 100,
    });
    // Give the second action a LATER occurred_at than the first, but build
    // it with a SMALLER actionIndex than would sort it first if occurred_at
    // were ignored — proves ordering is by occurred_at, not array order.
    const second = actionEvents({
      actionIndex: 1,
      actionType: "jsFunction",
      actionName: "computeTotal",
      durationMs: 50,
    }).events.map((event) => ({
      ...event,
      occurred_at: "2026-07-11T10:00:05.000Z",
    }));

    const merged = mergeRun([...second, ...first.events], first.spans, {
      actions: [],
    });

    expect(merged.degraded).toBe(false);
    expect(merged.steps).toHaveLength(2);
    const [step1, step2] = merged.steps as IActionStep[];
    expect(step1.actionType).toBe("endpointCall");
    expect(step1.name).toBe("callOrderApi");
    expect(step1.status).toBe("ok");
    expect(step1.nestingDepth).toBe(0);
    expect(step1.durationMs).toBe(100);
    expect(step2.actionType).toBe("jsFunction");
    expect(step2.name).toBe("computeTotal");
    expect(step2.status).toBe("ok");
    expect(
      merged.steps.some(
        (s) => s.type === "action" && s.status === "not_executed"
      )
    ).toBe(false);
  });

  it("events-only fallback: an agentCall action colors 'agent' and instanceId is the agent id", () => {
    const { events, spans } = actionEvents({
      actionIndex: 0,
      actionType: "agentCall",
      actionName: "askAgent",
      agentId: "support-agent",
    });
    const merged = mergeRun(events, spans, { actions: [] });
    const step = merged.steps[0] as IActionStep;
    expect(step.type).toBe("action");
    expect(step.color).toBe("agent");
    expect(step.instanceId).toBe("support-agent");
  });

  it("events-only fallback: a condition_evaluated event produces a decision node with empty branches (no plan)", () => {
    const cond = conditionEvent({
      actionIndex: 0,
      expression: "{{order.total}}",
      evaluatedValue: "320",
      branchTaken: "100-500",
      cases: ["<100", "100-500", ">500"],
    });
    const merged = mergeRun([cond], [], { actions: [] });
    expect(merged.steps).toHaveLength(1);
    const step = merged.steps[0] as IConditionalStep;
    expect(step.type).toBe("conditional");
    expect(step.executed).toBe(true);
    expect(step.evaluatedValue).toBe("320");
    expect(step.branchTaken).toBe("100-500");
    expect(step.hasDefault).toBe(false);
    expect(step.branches).toEqual([]);
    expect(step.conditionEventId).toBe(cond.event_id);

    // Doesn't crash layout-run with zero branches, and still chains
    // (regression: `takenTailId` used to stay `null` when `branches` is
    // empty, orphaning the next sibling's incoming edge).
    const layout = layoutRun(merged);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]!.kind).toBe("conditional");
    expect(layout.edges).toHaveLength(0);
  });

  it("run WITH a definition still uses the plan-driven path even when events are present (regression: fallback only triggers on empty definition)", () => {
    const { events, spans } = actionEvents({
      actionIndex: 0,
      actionType: "endpointCall",
      actionName: "callOrderApi",
      connectorId: "order-api",
    });
    const definition = {
      actions: [
        { activity: "endpointCall", name: "callOrderApi", args: {} },
        { activity: "jsFunction", name: "neverRan", args: {} },
      ],
    };
    const merged = mergeRun(events, spans, definition);
    // Plan-driven path renders BOTH definition actions (including the
    // not-executed second one) — the events-only fallback would only ever
    // produce the ONE executed step.
    expect(merged.steps).toHaveLength(2);
    expect((merged.steps[1] as IActionStep).status).toBe("not_executed");
  });

  it("degraded: a run with zero step events and an empty definition renders no steps and sets degraded", () => {
    const merged = mergeRun(
      [event({ kind: "execution_started", payload_action_index: null })],
      [],
      { actions: [] }
    );
    expect(merged.steps).toEqual([]);
    expect(merged.degraded).toBe(true);
  });

  it("regression: negative-duration guard picks the smallest NON-NEGATIVE candidate span, ignoring cartesian-paired negatives", () => {
    const started = event({
      event_id: "started-1",
      kind: "action_started",
      payload_action_index: 0,
      payload_action_type: "endpointCall",
      payload_action_name: "callOrderApi",
    });
    const completed = event({
      event_id: "completed-1",
      kind: "action_completed",
      payload_action_index: 0,
      payload_action_type: "endpointCall",
      payload_action_name: "callOrderApi",
      payload_step_status: "ok",
    });
    const spans: IRunSpan[] = [
      span({ event_id: "started-1", duration_ms: -158 }),
      span({ event_id: "started-1", duration_ms: 356 }),
      span({ event_id: "started-1", duration_ms: 900 }),
    ];
    const definition = {
      actions: [{ activity: "endpointCall", name: "callOrderApi", args: {} }],
    };
    const merged = mergeRun([started, completed], spans, definition);
    const step = merged.steps[0] as IActionStep;
    expect(step.durationMs).toBe(356);
  });

  it("regression: negative-duration guard returns null duration/range when every candidate span is negative", () => {
    const started = event({
      event_id: "started-1",
      kind: "action_started",
      payload_action_index: 0,
      payload_action_type: "endpointCall",
      payload_action_name: "callOrderApi",
    });
    const completed = event({
      event_id: "completed-1",
      kind: "action_completed",
      payload_action_index: 0,
      payload_action_type: "endpointCall",
      payload_action_name: "callOrderApi",
      payload_step_status: "ok",
    });
    const spans: IRunSpan[] = [
      span({ event_id: "started-1", duration_ms: -158 }),
      span({ event_id: "started-1", duration_ms: -42 }),
    ];
    const definition = {
      actions: [{ activity: "endpointCall", name: "callOrderApi", args: {} }],
    };
    const merged = mergeRun([started, completed], spans, definition);
    const step = merged.steps[0] as IActionStep;
    expect(step.durationMs).toBeNull();
    expect(step.startedAt).toBeNull();
    expect(step.completedAt).toBeNull();
  });

  it("degraded: a run with zero step events walks the definition with every step 'not_executed'", () => {
    const definition = {
      actions: [
        { activity: "endpointCall", name: "callOrderApi", args: {} },
        {
          activity: "conditional",
          name: "checkTotal",
          branches: [
            {
              label: "x",
              condition: { variable: "a", comparator: "eq", value: "1" },
              actions: [],
            },
          ],
        },
      ],
    };
    // execution_started is present (so the run resolves) but no step-level
    // kind at all — the T01 `step_detail: false` population.
    const merged = mergeRun(
      [event({ kind: "execution_started", payload_action_index: null })],
      [],
      definition
    );
    expect(merged.degraded).toBe(true);
    expect(merged.steps).toHaveLength(2);
    expect((merged.steps[0] as IActionStep).status).toBe("not_executed");
    expect((merged.steps[1] as IConditionalStep).executed).toBe(false);
  });
});
