/**
 * Structural graph validation for the workflow builder.
 *
 * Catches issues that the action-by-action validator can't see:
 *   - inbound CHANNEL trigger uniqueness
 *   - connections that reference non-existent nodes
 *   - orphan nodes (nodes that aren't reachable from a start node
 *     and have no incoming connections)
 *   - cycles in the non-branch graph
 *
 * Branch nodes legitimately fan out into N targets, so cycle and
 * orphan analysis treat them carefully (we only check reachability,
 * not "single chain" assumptions).
 */

import {
  EWorkflowNodeType,
  type IWorkflowConnection,
  type IWorkflowFlow,
  type IWorkflowNode,
} from "../workflow-node.types";
import type { ValidationError } from "./validation.types";

export function validateGraph(flow: IWorkflowFlow): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodes = flow.nodes;
  const connections = flow.connections;
  const nodeKeys = Object.keys(nodes);

  errors.push(...validateInboundUniqueness(nodes));
  errors.push(...validateConnections(connections, nodes));

  if (nodeKeys.length === 0) {
    return errors;
  }

  // Adjacency only over connections that point to existing nodes;
  // dangling edges already produced INVALID_CONNECTION above.
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const conn of Object.values(connections)) {
    if (!nodes[conn.source] || !nodes[conn.target]) continue;
    pushTo(outgoing, conn.source, conn.target);
    pushTo(incoming, conn.target, conn.source);
  }

  errors.push(...validateOrphans(nodes, incoming));
  errors.push(...validateCycles(nodes, outgoing));

  return errors;
}

function pushTo(
  map: Map<string, string[]>,
  key: string,
  value: string,
): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function isInboundChannel(node: IWorkflowNode): boolean {
  return (
    node.type === EWorkflowNodeType.CHANNEL &&
    node.configuration["direction"] === "inbound"
  );
}

function validateInboundUniqueness(
  nodes: Record<string, IWorkflowNode>,
): ValidationError[] {
  const inbound = Object.values(nodes).filter(isInboundChannel);
  if (inbound.length <= 1) return [];

  return inbound.slice(1).map((n) => ({
    nodeKey: n.key,
    nodeName: n.name,
    code: "MULTIPLE_TRIGGERS",
    message: "Only one inbound channel (trigger) is allowed per workflow.",
  }));
}

function validateConnections(
  connections: Record<string, IWorkflowConnection>,
  nodes: Record<string, IWorkflowNode>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const conn of Object.values(connections)) {
    if (!nodes[conn.source]) {
      errors.push({
        code: "INVALID_CONNECTION",
        message: `Connection ${conn.key} references unknown source node.`,
        field: `connections.${conn.key}.source`,
      });
    }
    if (!nodes[conn.target]) {
      errors.push({
        code: "INVALID_CONNECTION",
        message: `Connection ${conn.key} references unknown target node.`,
        field: `connections.${conn.key}.target`,
      });
    }
  }
  return errors;
}

/**
 * A node is an orphan if it has no incoming connections and is not
 * the inbound trigger. With only one node in the flow we don't flag
 * it (a single-node graph is the natural starting point).
 */
function validateOrphans(
  nodes: Record<string, IWorkflowNode>,
  incoming: Map<string, string[]>,
): ValidationError[] {
  const allKeys = Object.keys(nodes);
  if (allKeys.length <= 1) return [];

  const errors: ValidationError[] = [];
  for (const key of allKeys) {
    const node = nodes[key];
    if (isInboundChannel(node)) continue;
    if (!incoming.has(key)) {
      errors.push({
        nodeKey: key,
        nodeName: node.name,
        code: "ORPHAN_NODE",
        message: "Node has no incoming connection and is not the trigger.",
      });
    }
  }
  return errors;
}

/**
 * Detects cycles using DFS coloring (white/gray/black). A back-edge
 * to a gray node means we hit a cycle.
 */
function validateCycles(
  nodes: Record<string, IWorkflowNode>,
  outgoing: Map<string, string[]>,
): ValidationError[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const key of Object.keys(nodes)) {
    color.set(key, WHITE);
  }

  const reportedCycleNodes = new Set<string>();

  const visit = (start: string): void => {
    // Iterative DFS to avoid recursion limits on large graphs.
    const stack: Array<{ key: string; childIndex: number }> = [
      { key: start, childIndex: 0 },
    ];
    color.set(start, GRAY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = outgoing.get(frame.key) ?? [];
      if (frame.childIndex >= children.length) {
        color.set(frame.key, BLACK);
        stack.pop();
        continue;
      }
      const next = children[frame.childIndex++];
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        reportedCycleNodes.add(next);
        continue;
      }
      if (c === WHITE) {
        color.set(next, GRAY);
        stack.push({ key: next, childIndex: 0 });
      }
    }
  };

  for (const key of Object.keys(nodes)) {
    if (color.get(key) === WHITE) visit(key);
  }

  const errors: ValidationError[] = [];
  for (const key of reportedCycleNodes) {
    const node = nodes[key];
    errors.push({
      nodeKey: key,
      nodeName: node?.name,
      code: "CYCLE_DETECTED",
      message: "Cycle detected: this node forms a loop in the workflow graph.",
    });
  }
  return errors;
}
