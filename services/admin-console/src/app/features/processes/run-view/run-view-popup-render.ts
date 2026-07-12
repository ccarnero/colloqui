// run-view-popup-render.ts — pure geometry + string/routing helpers for
// `run-view-popup.component.ts` (T05 of manual-loops/run-view.md), same
// split as `run-view-render.ts`: pixel math and peek-kind/deep-link
// decisions live here so they stay unit-testable without TestBed/DOM;
// the component only binds this module's output.

import type { ActionStatus, ILayoutNode } from "./domain/run-view.model";

export type PeekKind = "connector" | "agent" | "channel" | null;

/** `WorkflowActionKind`s whose `instanceId` is a `connectors` adapter id
 * (`instanceIdFromPair` in `merge-run.ts`: `payload_connector_id`). */
const CONNECTOR_ACTION_TYPES: ReadonlySet<string> = new Set([
  "endpointCall",
  "mcpCall",
  "serviceCall",
]);

/**
 * Which peek sub-view (if any) a clicked node offers, from `actionType`
 * (SPEC.md T05: "connector profile ... agent profile ... channel account").
 * `jsFunction`/`serviceBusCall`/`branch`/`conditional`/`join` carry no
 * artifact instance and offer no peek.
 */
export function resolvePeekKind(node: ILayoutNode): PeekKind {
  if (!node.instanceId || !node.actionType) {
    return null;
  }
  if (CONNECTOR_ACTION_TYPES.has(node.actionType)) {
    return "connector";
  }
  if (node.actionType === "agentCall") {
    return "agent";
  }
  if (node.actionType === "channelSend") {
    return "channel";
  }
  return null;
}

/** `ActionStatus` -> readable English label, same wording as
 * `run-view-render.ts`'s `formatNodeStatusLabel` (kept as a local copy —
 * that module is T04's, this one is T05's, and the two features must not
 * cross-import to stay independently deployable/testable). */
export function formatPopupStatusLabel(status: ActionStatus): string {
  if (status === "not_executed") {
    return "not executed";
  }
  return status;
}

export interface IViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface IAnchorRect {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export type AnchorSide = "left" | "right";

export interface IAnchorPosition {
  readonly top: number;
  readonly left: number;
  readonly side: AnchorSide;
}

const POPUP_GAP = 12;
const VIEWPORT_MARGIN = 8;

/**
 * Anchors the popup beside the clicked step (DESIGN.md: "side depends on
 * position") — right of the node when there is room, else left; clamped
 * to the viewport on both axes so the popup is always fully visible
 * WITHOUT the page scrolling to show it (SPEC.md user decision 1). A
 * degenerate all-zero `anchorRect` (e.g. an untested/undetectable DOM
 * measurement) still produces a valid, clamped, on-screen position.
 */
export function computeAnchorPosition(
  anchorRect: IAnchorRect,
  viewport: IViewportSize,
  popupSize: IViewportSize
): IAnchorPosition {
  const roomOnRight = viewport.width - anchorRect.right;
  const side: AnchorSide =
    roomOnRight >= popupSize.width + POPUP_GAP ||
    anchorRect.left < viewport.width / 2
      ? "right"
      : "left";

  const rawLeft =
    side === "right"
      ? anchorRect.right + POPUP_GAP
      : anchorRect.left - popupSize.width - POPUP_GAP;
  const rawTop = anchorRect.top;

  const maxLeft = viewport.width - popupSize.width - VIEWPORT_MARGIN;
  const maxTop = viewport.height - popupSize.height - VIEWPORT_MARGIN;

  return {
    left: clamp(rawLeft, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, maxLeft)),
    top: clamp(rawTop, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, maxTop)),
    side,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── Deep links (verified against app.routes.ts) ──────────────────────
//
// - Connector detail: `connections/http/:id`
// - Agent detail:     `ai/agents/:id`
// - Channel account:  `channels/:channel/accounts/:accountId`
// - Workflow builder: `workflows/:id/builder`

export function connectorDeepLink(adapterId: string): readonly string[] {
  return ["/connections/http", adapterId];
}

export function agentDeepLink(agentId: string): readonly string[] {
  return ["/ai/agents", agentId];
}

export function channelDeepLink(
  channel: string,
  accountId: string
): readonly string[] {
  return ["/channels", channel, "accounts", accountId];
}

export function workflowDeepLink(workflowId: string): readonly string[] {
  return ["/workflows", workflowId, "builder"];
}
