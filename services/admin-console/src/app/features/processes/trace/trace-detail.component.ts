import { DecimalPipe } from "@angular/common";
import type { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  type OnInit,
  signal,
  viewChild,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { environment } from "../../../../environments/environment";
import { AuthService } from "../../../core/services/auth.service";
import {
  type IEventPayloadResponse,
  type ITrackedEvent,
  type ITrackingChainResponse,
  TrackingChainService,
} from "../../../core/services/tracking-chain.service";
import { resolveBuilderDeepLink } from "../domain/resolve-builder-deep-link";
import { resolveTemporalDeepLink } from "../domain/resolve-temporal-deep-link";
import { RunViewComponent } from "../run-view/run-view.component";
import { computeCausalChain } from "./causal-graph/causal-chain";
import { CausalGraphComponent } from "./causal-graph/causal-graph.component";
import { resolveTrackedEventDeepLink } from "./causal-graph/causal-graph-deep-link";
import { findWorkflowRuns } from "./domain/find-workflow-runs";
import { MessageTraceComponent } from "./message-trace.component";
import { StepLogComponent } from "./step-log/step-log.component";
import { TraceSummaryStripComponent } from "./summary-strip/trace-summary-strip.component";
import { TraceSelectionService } from "./trace-selection.service";
import { TraceWaterfallComponent } from "./waterfall/trace-waterfall.component";
import { computeEventTimingPercent } from "./waterfall/waterfall-geometry";

/** Tenant-admin permission gating the payload viewer (SPEC.md
 * `manual-loops/payload-capture.md` T05 — reuses the console's existing
 * `AuthService.hasPermission()` gate). T04
 * (`manual-loops/admin-console/console-redesign-trace.md`) migrated this
 * gate + the on-demand payload fetch it guards from
 * `CausalGraphComponent`'s local detail card into this shared inspector
 * (see the class header comment). */
const PAYLOAD_PERMISSION = "tracking:payload:read";

/** Local view-state for the on-demand payload fetch, keyed to whichever
 * event is currently selected — reset whenever the selection changes
 * (migrated from `CausalGraphComponent`, T04). */
type PayloadViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly response: IEventPayloadResponse }
  | { readonly kind: "expired" }
  | { readonly kind: "not-captured"; readonly message: string }
  | { readonly kind: "error" };

/** The four ways to look at a correlation's tracked-event chain — "run"
 * only appears when the chain contains a workflow run (T06 of
 * manual-loops/run-view.md, entry (b)). Matches the ORCHESTRATOR RULING
 * under decision 5(a) of console-redesign-trace.md: the tab set is
 * waterfall/causal/legacy/run — "step log" is a sub-panel INSIDE the
 * "run" tab (T04), never a fifth tab. */
export type TraceViewTab = "waterfall" | "causal" | "legacy" | "run";

const TABS: ReadonlyArray<{
  readonly id: TraceViewTab;
  readonly label: string;
}> = [
  { id: "waterfall", label: "Waterfall" },
  { id: "causal", label: "Causal graph" },
  { id: "legacy", label: "Legacy" },
];

const RUN_TAB = { id: "run" as const, label: "Run view" };

/**
 * Container for processes/trace/:correlationId — fetches the tracking
 * chain ONCE via TrackingChainService and feeds it to the Waterfall and
 * Causal graph views. The pre-existing client-side assembly
 * (assemble-trace.ts via MessageTraceComponent) stays available,
 * unmodified, as the third "Legacy" tab (SPEC.md manual-loops/trace-console.md T07).
 *
 * T02 (manual-loops/admin-console/console-redesign-trace.md) adds the
 * shared TraceSelectionService (component-provided below — see that
 * file's header comment for the provider-scope justification) and a
 * docked inspector panel SHELL that reacts to it.
 *
 * T03 adds the inspector's waterfall-mode content (decision 3 + the
 * ORCHESTRATOR RULING): base event fields (whatever ITrackedEvent carries
 * — SPEC.md T01 finding item 3's "base dl" field mapping) plus timing % of
 * the chain's total span, computed by computeEventTimingPercent
 * (waterfall/waterfall-geometry.ts) — the SAME span-matching data the
 * waterfall bars already render from, not a re-derived heuristic.
 *
 * T04 adds:
 * - The inspector's CAUSAL-mode content (decision 3's "causal chain in
 *   causal graph"): the same base `dl` fields (the mock's base section
 *   applies "everywhere", decision 3), a "Causal chain" block derived by
 *   `computeCausalChain` (`causal-graph/causal-chain.ts`, walking
 *   `causation_id` parent links), the on-demand payload viewer, and the
 *   "Open connector" deep link — all MIGRATED here from
 *   `CausalGraphComponent`'s old local detail card (T01 finding item 2:
 *   that component used to own a `selected` signal + inline
 *   `.cg-detail` card; decision 2 forbids view-local selection state).
 *   `CausalGraphComponent` itself is now presentation-only: it calls
 *   `TraceSelectionService.select(eventId, "causal")` on node click and
 *   reads the service's signal for node highlight, same pattern as
 *   `TraceWaterfallComponent` (T03).
 * - The STEP LOG panel (`StepLogComponent`), embedded in the "run" tab
 *   branch below `<app-run-view>`. PLACEMENT CHOICE (documented per the
 *   task instructions): the ORCHESTRATOR RULING under decision 5(a) places
 *   the step log INSIDE the "run" tab, matching the design mock exactly
 *   (`Rediseño Terminal.dc.html` lines 932-943) — T05 restyles the run tab
 *   area around it, wiring the run canvas into the shared selection.
 *
 * T05 (`manual-loops/admin-console/console-redesign-trace.md`) adds the
 * run-mode inspector content (decision 3's "step result in run view"):
 * the same base dl fields plus a "Step result" block, sourced from
 * `RunViewComponent.selectedStepResult()` via a `viewChild` signal query
 * (`runView` below) — this container never fetches run data itself, it
 * only reads the derived step-result data the embedded run canvas already
 * computed from its own loaded `IRunResponse`/`IRunLayout`.
 *
 * T06 (`manual-loops/admin-console/console-redesign-trace.md`) adds the
 * inspector's DEEP LINKS block (decision 4 + the ORCHESTRATOR RULING),
 * rendered "everywhere" a selection exists (see the template's deep-links
 * block near the end of the inspector body): a real "Open in Temporal"
 * link when the selected event carries `workflow_id`/`run_id`
 * (`resolveTemporalDeepLink`, extracted from `message-trace.component.ts`'s
 * `temporalUrl()` without changing its output), a real "Open
 * <entity>" link when the event resolves to one (waterfall/causal via
 * `resolveTrackedEventDeepLink`, run-mode via
 * `RunViewComponent.selectedStepDeepLink()`), and an ALWAYS-hidden builder
 * link (`resolveBuilderDeepLink` — no trace-event->builder-node id bridge
 * exists yet, never synthesized).
 */
@Component({
  selector: "app-trace-detail",
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Component-provided, not root: TraceSelectionService must live only
  // while this trace screen instance is mounted (see that service's
  // header comment for why a route-level/global singleton is the wrong
  // scope).
  providers: [TraceSelectionService],
  imports: [
    CausalGraphComponent,
    MessageTraceComponent,
    TraceWaterfallComponent,
    RunViewComponent,
    StepLogComponent,
    TraceSummaryStripComponent,
    DecimalPipe,
    RouterLink,
  ],
  host: {
    // Esc clears the selection (closes the inspector) from anywhere in the
    // trace screen. Embedded widgets that add their OWN Escape handling in
    // later tasks (e.g. a future causal-graph node popup) MUST call
    // $event.stopPropagation() in their own handler if they want to
    // consume Esc without also triggering this host-level clear — this
    // handler itself is a no-op when nothing is selected, so an accidental
    // double-fire is harmless, but a widget with its OWN close semantics
    // (e.g. "back up one level" before fully closing) needs to opt out.
    "(keydown.escape)": "onEscape()",
  },
  template: `
    <header class="td-head">
      <div>
        <h1>Trace · {{ correlationId() }}</h1>
        <span class="td-sub">Processes › Trace</span>
      </div>
    </header>

    <div class="td-tabs" role="tablist" aria-label="Trace view">
      @for (t of visibleTabs(); track t.id) {
        <button
          type="button"
          role="tab"
          class="td-tab"
          [class.is-active]="activeTab() === t.id"
          [attr.aria-selected]="activeTab() === t.id"
          (click)="activeTab.set(t.id)"
        >
          {{ t.label }}
        </button>
      }
    </div>

    <!-- T07 (T01 finding 11): shared 5-cell summary strip, identical for all
         four tabs, per mock's "Summary strip (shared)" comment
         (Rediseño Terminal.dc.html lines 717-724). Only rendered once the
         chain has loaded — every cell derives from ITrackingChainResponse
         data already fetched above, nothing new fetched. -->
    @if (chain(); as summaryChain) {
      <app-trace-summary-strip [chain]="summaryChain" />
    }

    <div class="td-body">
      <div class="td-main">
        @if (activeTab() === "legacy") {
          <app-message-trace />
        } @else if (activeTab() === "run") {
          @if (workflowRun(); as run) {
            <!-- T06 finding fix (manual-loops/run-view.md): no definitionId
                 input here — findWorkflowRuns only has the Temporal
                 workflow/run ids from the chain's events, not the workflow
                 DEFINITION id. RunViewComponent degrades gracefully: it skips
                 the definition fetch (no 404 against the Temporal id) and the
                 header falls back to the raw workflow id instead of the name. -->
            <app-run-view [workflowId]="run.workflowId" [runId]="run.runId" />
          }
          @if (chain(); as c) {
            <!-- T04: step log sub-panel, per the ORCHESTRATOR RULING under
                 decision 5(a) — see this component's header comment for the
                 placement choice. -->
            <app-step-log [chain]="c" />
          }
        } @else {
          @if (loading()) {
            <p class="td-muted">Loading…</p>
          }
          @if (error()) {
            <p class="td-error">{{ error() }}</p>
          }
          @if (chain(); as c) {
            @if (activeTab() === "waterfall") {
              <app-trace-waterfall [chain]="c" />
            } @else if (activeTab() === "causal") {
              <app-causal-graph [chain]="c" />
            }
          }
        }
      </div>

      <!-- Docked event inspector SHELL (T02): ALWAYS rendered — an empty
           state when nothing is selected, populated once
           TraceSelectionService.selectedEventId() is set. Per-view
           context content (payload, timing %, step result, causal chain,
           Temporal/builder deep links — decisions 3/4) is filled in by
           T03-T06; T03 added the waterfall-mode content, T04 the
           causal-mode content, T05 the run-mode content, T06 the deep
           links block below. -->
      <aside class="td-inspector" aria-label="Event inspector">
        @if (selection.selectedEventId(); as selectedId) {
          <header class="td-inspector-head">
            <span class="td-inspector-title">Event · {{ selectedId }}</span>
            @if (selection.sourceView(); as source) {
              <span class="td-inspector-source">{{ source }}</span>
            }
            <button
              type="button"
              class="td-inspector-close"
              aria-label="Close inspector"
              (click)="closeInspector()"
            >
              ×
            </button>
          </header>
          <div class="td-inspector-body">
            @if (isWaterfallSelection() && selectedEvent(); as event) {
              <!-- T03 waterfall-mode content: timing % (decision 3), then
                   base ITrackedEvent fields (mirrors the design mock's base
                   dl — event_id/causation/depth/tech/business_fn/
                   claim_check/compliance/subject — using REAL field
                   values, not the mock's hardcoded placeholders). -->
              @if (selectedEventTimingPercent(); as pct) {
                <div class="td-timing">
                  <span class="td-timing-label">timing</span>
                  <span class="td-timing-value">{{ pct | number: "1.0-1" }}% of total</span>
                </div>
              } @else {
                <div class="td-timing td-timing--none">
                  <span class="td-timing-label">timing</span>
                  <span class="td-timing-value">no duration data</span>
                </div>
              }
              <dl class="td-base">
                <dt>event_id</dt>
                <dd>{{ event.event_id }}</dd>
                <dt>kind</dt>
                <dd>{{ event.kind ?? "—" }}</dd>
                <dt>causation</dt>
                <dd>{{ event.causation_id ?? "—" }}</dd>
                <dt>depth</dt>
                <dd>{{ event.causation_depth ?? "—" }}</dd>
                <dt>tech</dt>
                <dd>{{ event.tech }}</dd>
                <dt>business_fn</dt>
                <dd>{{ event.business_fn }}</dd>
                <dt>claim_check</dt>
                <dd>{{ event.is_claim_check }}</dd>
                <dt>compliance</dt>
                <dd>{{ event.compliance }}</dd>
                <dt>subject</dt>
                <dd>{{ event.subject }}</dd>
              </dl>
            } @else if (isCausalSelection() && selectedEvent(); as event) {
              <!-- T04 causal-mode content: base fields (same "everywhere"
                   dl as waterfall-mode, decision 3), the derived causal
                   chain, and the on-demand payload viewer — migrated from
                   CausalGraphComponent's old local detail card. Its "Open
                   connector" deep link now lives in T06's "everywhere"
                   deep-links block below. -->
              <dl class="td-base">
                <dt>event_id</dt>
                <dd>{{ event.event_id }}</dd>
                <dt>kind</dt>
                <dd>{{ event.kind ?? "—" }}</dd>
                <dt>causation</dt>
                <dd>{{ event.causation_id ?? "—" }}</dd>
                <dt>depth</dt>
                <dd>{{ event.causation_depth ?? "—" }}</dd>
                <dt>tech</dt>
                <dd>{{ event.tech }}</dd>
                <dt>business_fn</dt>
                <dd>{{ event.business_fn }}</dd>
                <dt>claim_check</dt>
                <dd>{{ event.is_claim_check }}</dd>
                <dt>compliance</dt>
                <dd>
                  {{ event.compliance }}
                  @if (event.tenant === null) {
                    <span class="td-flag">null tenant</span>
                  }
                </dd>
                <dt>subject</dt>
                <dd>{{ event.subject }}</dd>
              </dl>

              <div class="td-causal-chain" aria-label="Causal chain">
                <h4 class="td-causal-chain-title">Causal chain</h4>
                <ol class="td-causal-chain-list">
                  @for (
                    entry of selectedCausalChainEntries();
                    track entry.eventId
                  ) {
                    <li
                      class="td-causal-chain-entry"
                      [class.td-causal-chain-entry--current]="entry.isSelected"
                    >
                      <span class="td-causal-chain-kind">{{ entry.kind }}</span>
                      @if (!entry.causationId) {
                        <span class="td-causal-chain-root">root</span>
                      }
                    </li>
                  }
                </ol>
                @if (selectedCausalChainRootUnresolvedParentId(); as missingId) {
                  <p class="td-causal-chain-orphan">
                    missing parent: {{ missingId }}
                  </p>
                }
              </div>

              @if (canViewPayload()) {
                <div class="td-payload">
                  <button
                    type="button"
                    class="td-payload-btn"
                    (click)="viewPayload(event.event_id)"
                  >
                    View payload
                  </button>

                  @switch (payloadState().kind) {
                    @case ("loading") {
                      <p class="td-payload-status">Loading payload…</p>
                    }
                    @case ("expired") {
                      <p class="td-payload-status">
                        Payload expired (30-day retention)
                      </p>
                    }
                    @case ("not-captured") {
                      <p class="td-payload-status">
                        {{ notCapturedMessage() }}
                      </p>
                    }
                    @case ("error") {
                      <p class="td-payload-status td-payload-error">
                        Failed to load payload.
                      </p>
                    }
                    @case ("loaded") {
                      <details class="td-payload-details">
                        <summary>
                          Payload ({{ loadedResponse()?.payload_status }})
                        </summary>
                        <pre class="td-payload-pre">{{ payloadJson() }}</pre>
                      </details>
                    }
                  }
                </div>
              }
            } @else if (isRunSelection() && selectedEvent(); as event) {
              <!-- T05 run-mode content: base fields (same "everywhere" dl
                   as waterfall/causal-mode, decision 3) plus STEP RESULT
                   for the selected event's step (decision 3: "step result
                   in run view"), sourced from RunViewComponent's OWN
                   already-loaded run data via the runView viewChild query
                   below — real fields only, nothing invented. -->
              <dl class="td-base">
                <dt>event_id</dt>
                <dd>{{ event.event_id }}</dd>
                <dt>kind</dt>
                <dd>{{ event.kind ?? "—" }}</dd>
                <dt>causation</dt>
                <dd>{{ event.causation_id ?? "—" }}</dd>
                <dt>depth</dt>
                <dd>{{ event.causation_depth ?? "—" }}</dd>
                <dt>tech</dt>
                <dd>{{ event.tech }}</dd>
                <dt>business_fn</dt>
                <dd>{{ event.business_fn }}</dd>
                <dt>claim_check</dt>
                <dd>{{ event.is_claim_check }}</dd>
                <dt>compliance</dt>
                <dd>{{ event.compliance }}</dd>
                <dt>subject</dt>
                <dd>{{ event.subject }}</dd>
              </dl>

              @if (runStepResult(); as step) {
                <div class="td-step-result" aria-label="Step result">
                  <h4 class="td-step-result-title">Step result</h4>
                  <dl class="td-base">
                    <dt>step</dt>
                    <dd>{{ step.stepName }}</dd>
                    <dt>kind</dt>
                    <dd>{{ step.kind }}</dd>
                    @if (step.actionType) {
                      <dt>action type</dt>
                      <dd>{{ step.actionType }}</dd>
                    }
                    <dt>status</dt>
                    <dd>{{ step.status }}</dd>
                    @if (step.durationMs !== null) {
                      <dt>duration</dt>
                      <dd>{{ step.durationMs }} ms</dd>
                    }
                    @if (step.branchTaken !== null) {
                      <dt>branch</dt>
                      <dd>{{ step.branchTaken }}</dd>
                    }
                    @if (step.evaluatedValue !== null) {
                      <dt>evaluated</dt>
                      <dd>{{ step.evaluatedValue }}</dd>
                    }
                    @if (step.instanceId !== null) {
                      <dt>instance</dt>
                      <dd>{{ step.instanceId }}</dd>
                    }
                  </dl>
                </div>
              } @else {
                <p class="td-muted">
                  No step result available for this selection.
                </p>
              }
            }

            @if (selectedEvent(); as event) {
              <!-- T06 deep links (decision 4 + the ORCHESTRATOR RULING):
                   rendered "everywhere" a selection exists — unlike T04's
                   causal-only "Open connector" button it replaces.
                   TEMPORAL: real link when the event carries
                   workflow_id/run_id, hidden (+ console.debug) otherwise.
                   BUILDER: always hidden today — no id bridge exists
                   (resolve-builder-deep-link.ts), never synthesized.
                   ENTITY: "Open connector"/"Open agent" when the event
                   resolves to one (causal/waterfall via
                   resolveTrackedEventDeepLink, run-mode via the run
                   canvas's own selectedStepDeepLink()). -->
              <div class="td-deep-links" aria-label="Deep links">
                <h4 class="td-deep-links-title">Deep links</h4>
                @if (selectedTemporalDeepLink(); as temporalUrl) {
                  <div class="td-deep-link">
                    <a
                      class="td-deep-link-btn"
                      [href]="temporalUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Temporal
                    </a>
                  </div>
                }
                @if (selectedEntityDeepLink(); as link) {
                  <div class="td-deep-link">
                    <a class="td-deep-link-btn" [routerLink]="link.route">
                      {{ link.label }}
                    </a>
                  </div>
                }
                @if (selectedBuilderDeepLink(); as builderLink) {
                  <div class="td-deep-link">
                    <a
                      class="td-deep-link-btn"
                      [routerLink]="builderLink.route"
                    >
                      {{ builderLink.label }}
                    </a>
                  </div>
                }
                @if (
                  !selectedTemporalDeepLink() &&
                  !selectedEntityDeepLink() &&
                  !selectedBuilderDeepLink()
                ) {
                  <p class="td-muted">
                    No deep links available for this event.
                  </p>
                }
              </div>
            }
          </div>
        } @else {
          <div class="td-inspector-body td-inspector-body--empty">
            <p class="td-inspector-empty">Select an event…</p>
          </div>
        }
      </aside>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 16px;
    }
    h1 {
      font-size: 18px;
      margin: 0;
    }
    .td-sub,
    .td-muted {
      color: var(--text-muted, #888);
      font-size: 12px;
    }
    .td-head {
      margin-bottom: 12px;
    }
    .td-error {
      color: var(--text-danger, #b3261e);
    }

    .td-tabs {
      display: inline-flex;
      border: 1px solid var(--rd-line-3, #2e2e2e);
      border-radius: var(--rd-radius-7, 8px);
      overflow: hidden;
      margin-bottom: var(--rd-space-8, 16px);
    }
    .td-tab {
      padding: var(--rd-space-5, 10px) var(--rd-space-7, 14px);
      font-size: var(--rd-text-size-sm, 12.5px);
      font-weight: 500;
      color: var(--rd-text-3, #7a7a7a);
      background: transparent;
      border: 0;
      border-right: 1px solid var(--rd-line-2, #161616);
      cursor: pointer;
      font-family: inherit;
      transition: color 0.15s, background 0.15s;
    }
    .td-tab:last-child {
      border-right: none;
    }
    .td-tab:hover {
      color: var(--rd-text-1, #ededed);
    }
    .td-tab.is-active {
      background: var(--rd-hover, #1a1a1a);
      color: var(--rd-text-1, #ededed);
    }

    .td-body {
      display: flex;
      gap: var(--rd-space-8, 16px);
      align-items: flex-start;
    }
    .td-main {
      flex: 1 1 auto;
      min-width: 0;
    }

    .td-inspector {
      flex: 0 0 320px;
      border: 1px solid var(--rd-line-3, #2e2e2e);
      border-radius: var(--rd-radius-11, 14px);
      overflow: hidden;
      background: var(--rd-bg, #0a0a0a);
      position: sticky;
      top: 16px;
    }
    .td-inspector-head {
      display: flex;
      align-items: center;
      gap: var(--rd-space-5, 9px);
      padding: var(--rd-space-7, 13px) var(--rd-space-8, 16px);
      border-bottom: 1px solid var(--rd-line, #1f1f1f);
    }
    .td-inspector-title {
      flex: 1 1 auto;
      min-width: 0;
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-base, 13px);
      font-weight: 600;
      color: var(--rd-text-1, #ededed);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .td-inspector-source {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      color: var(--rd-text-3, #7a7a7a);
      background: var(--rd-hover, #1a1a1a);
      border-radius: var(--rd-radius-3, 4px);
      padding: 1px var(--rd-space-4, 8px);
      flex-shrink: 0;
    }
    .td-inspector-close {
      width: 26px;
      height: 26px;
      flex-shrink: 0;
      border: none;
      background: transparent;
      border-radius: var(--rd-radius-5, 6px);
      color: var(--rd-text-2, #a1a1a1);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
    }
    .td-inspector-close:hover {
      background: var(--rd-hover, #1a1a1a);
    }
    .td-inspector-body {
      padding: var(--rd-space-7, 14px) var(--rd-space-8, 16px);
    }
    .td-inspector-body--empty {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
    }
    .td-inspector-empty {
      margin: 0;
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-sm, 12px);
    }

    .td-timing {
      display: flex;
      flex-direction: column;
      gap: 2px;
      background: var(--rd-panel, #141414);
      border: 1px solid var(--rd-line-2, #161616);
      border-radius: var(--rd-radius-5, 8px);
      padding: var(--rd-space-4, 8px) var(--rd-space-5, 10px);
      margin-bottom: var(--rd-space-6, 12px);
    }
    .td-timing-label {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 9px);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--rd-text-3, #7a7a7a);
    }
    .td-timing-value {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-1, #ededed);
    }
    .td-timing--none .td-timing-value {
      color: var(--rd-text-3, #7a7a7a);
    }

    .td-base {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--rd-space-3, 6px) var(--rd-space-5, 10px);
      margin: 0;
      font-size: var(--rd-text-size-sm, 12px);
    }
    .td-base dt {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--rd-text-3, #7a7a7a);
    }
    .td-base dd {
      margin: 0;
      font-family: var(--rd-font-mono);
      color: var(--rd-text-1, #ededed);
      word-break: break-all;
    }
    .td-flag {
      display: inline-block;
      margin-left: var(--rd-space-3, 6px);
      padding: 1px var(--rd-space-4, 6px);
      border-radius: var(--rd-radius-3, 4px);
      background: var(--rd-red-soft, #3a1a1a);
      color: var(--rd-red, #ff6b6b);
      font-size: var(--rd-text-size-2xs, 10px);
    }

    .td-causal-chain {
      margin-top: var(--rd-space-6, 12px);
      padding-top: var(--rd-space-6, 12px);
      border-top: 1px solid var(--rd-line-2, #161616);
    }
    .td-causal-chain-title {
      margin: 0 0 var(--rd-space-4, 8px);
      font-size: var(--rd-text-size-sm, 12px);
      font-weight: 600;
      color: var(--rd-text-1, #ededed);
    }
    .td-causal-chain-list {
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-3, 6px);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--rd-text-size-sm, 12px);
    }
    .td-causal-chain-entry {
      display: flex;
      align-items: center;
      gap: var(--rd-space-3, 6px);
      font-family: var(--rd-font-mono);
      color: var(--rd-text-2, #a1a1a1);
    }
    .td-causal-chain-entry--current {
      color: var(--rd-text-1, #ededed);
      font-weight: 600;
    }
    .td-causal-chain-root {
      font-family: inherit;
      font-size: var(--rd-text-size-2xs, 10px);
      color: var(--rd-text-3, #7a7a7a);
      background: var(--rd-hover, #1a1a1a);
      border-radius: var(--rd-radius-3, 4px);
      padding: 1px var(--rd-space-3, 6px);
    }
    .td-causal-chain-orphan {
      margin: var(--rd-space-4, 8px) 0 0;
      color: var(--rd-red, #ff6b6b);
      font-size: var(--rd-text-size-2xs, 10px);
    }

    .td-step-result {
      margin-top: var(--rd-space-6, 12px);
      padding-top: var(--rd-space-6, 12px);
      border-top: 1px solid var(--rd-line-2, #161616);
    }
    .td-step-result-title {
      margin: 0 0 var(--rd-space-4, 8px);
      font-size: var(--rd-text-size-sm, 12px);
      font-weight: 600;
      color: var(--rd-text-1, #ededed);
    }

    .td-payload {
      margin-top: var(--rd-space-6, 12px);
      padding-top: var(--rd-space-6, 12px);
      border-top: 1px solid var(--rd-line-2, #161616);
    }
    .td-payload-btn {
      padding: var(--rd-space-3, 4px) var(--rd-space-5, 10px);
      font-size: var(--rd-text-size-sm, 12px);
      border: 1px solid var(--rd-accent, #1a66ff);
      border-radius: var(--rd-radius-5, 6px);
      background: transparent;
      color: var(--rd-accent, #1a66ff);
      cursor: pointer;
    }
    .td-payload-status {
      margin: var(--rd-space-4, 8px) 0 0;
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-sm, 12px);
    }
    .td-payload-error {
      color: var(--rd-red, #ff6b6b);
    }
    .td-payload-details {
      margin-top: var(--rd-space-4, 8px);
    }
    .td-payload-pre {
      margin: var(--rd-space-3, 6px) 0 0;
      padding: var(--rd-space-4, 8px);
      background: var(--rd-panel, #141414);
      border-radius: var(--rd-radius-5, 6px);
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
      font-size: var(--rd-text-size-2xs, 11px);
    }

    .td-deep-links {
      margin-top: var(--rd-space-6, 12px);
      padding-top: var(--rd-space-6, 12px);
      border-top: 1px solid var(--rd-line-2, #161616);
    }
    .td-deep-links-title {
      margin: 0 0 var(--rd-space-4, 8px);
      font-size: var(--rd-text-size-sm, 12px);
      font-weight: 600;
      color: var(--rd-text-1, #ededed);
    }
    .td-deep-link {
      margin-top: var(--rd-space-4, 8px);
    }
    .td-deep-link:first-of-type {
      margin-top: 0;
    }
    .td-deep-link-btn {
      display: inline-block;
      padding: var(--rd-space-3, 4px) var(--rd-space-5, 10px);
      font-size: var(--rd-text-size-sm, 12px);
      border: 1px solid var(--rd-accent, #1a66ff);
      border-radius: var(--rd-radius-5, 6px);
      background: transparent;
      color: var(--rd-accent, #1a66ff);
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
    }
  `,
})
export class TraceDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly trackingChainService = inject(TrackingChainService);
  private readonly auth = inject(AuthService);

  /** Single shared selection state for this trace screen's four tabs
   * (decision 2). Public/readonly so the template can read it directly —
   * no view-local selection signal exists anywhere in this feature area. */
  readonly selection = inject(TraceSelectionService);

  readonly tabs = TABS;
  readonly correlationId = signal("");
  readonly activeTab = signal<TraceViewTab>("waterfall");
  readonly chain = signal<ITrackingChainResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Gates the causal-mode "View payload" action — SPEC.md
   * `manual-loops/payload-capture.md` T05: "visible only when the session
   * user has the admin permission". Migrated from `CausalGraphComponent`
   * (T04). */
  readonly canViewPayload = computed(() =>
    this.auth.hasPermission(PAYLOAD_PERMISSION)
  );

  private readonly payload = signal<PayloadViewState>({ kind: "idle" });
  readonly payloadState = computed(() => this.payload());

  readonly loadedResponse = computed<IEventPayloadResponse | null>(() => {
    const state = this.payload();
    return state.kind === "loaded" ? state.response : null;
  });

  readonly payloadJson = computed(() => {
    const response = this.loadedResponse();
    return response ? JSON.stringify(response.payload, null, 2) : "";
  });

  readonly notCapturedMessage = computed(() => {
    const state = this.payload();
    return state.kind === "not-captured" ? state.message : "";
  });

  /** T06 (entry b): distinct workflow runs found in the chain's events.
   * manual-loops/run-view.md T06: "pick the FIRST workflow run" when a
   * shared trigger fans out to more than one — DESIGN-run-view.md does not
   * mandate a selector, so this stays the simple documented choice. */
  private readonly workflowRuns = computed(() => {
    const c = this.chain();
    return c ? findWorkflowRuns(c.events) : [];
  });

  readonly workflowRun = computed(() => this.workflowRuns()[0] ?? null);

  /** "Run view" only appears once the chain resolved and contains a
   * workflow run (SPEC.md: tab appears WHEN the chain contains a run). */
  readonly visibleTabs = computed(() =>
    this.workflowRuns().length > 0 ? [...TABS, RUN_TAB] : TABS
  );

  /** True when the current selection came from the waterfall tab (T03) —
   * gates the waterfall-mode inspector content (base fields + timing %). */
  readonly isWaterfallSelection = computed(
    () => this.selection.sourceView() === "waterfall"
  );

  /** True when the current selection came from the causal-graph tab (T04)
   * — gates the causal-mode inspector content (base fields + causal chain
   * + payload). */
  readonly isCausalSelection = computed(
    () => this.selection.sourceView() === "causal"
  );

  /** The currently-selected event's full record from the loaded chain —
   * shared by waterfall-mode, causal-mode, AND run-mode inspector content.
   * null when nothing is selected, or when the selected id somehow isn't
   * in the currently-loaded chain (defensive; should not happen since the
   * chain is the only source of selectable events on this screen). */
  readonly selectedEvent = computed<ITrackedEvent | null>(() => {
    const c = this.chain();
    const id = this.selection.selectedEventId();
    if (!c || !id) {
      return null;
    }
    return c.events.find((e) => e.event_id === id) ?? null;
  });

  /** Timing % of the chain's total span for the selected event (T03,
   * decision 3's "timing % in waterfall" content) — reuses
   * computeEventTimingPercent (waterfall-geometry.ts), the SAME
   * span-matching data the waterfall bars render from. null when the
   * event has no matched duration — the inspector shows no percentage
   * rather than inventing one. */
  readonly selectedEventTimingPercent = computed<number | null>(() => {
    const c = this.chain();
    const id = this.selection.selectedEventId();
    if (!c || !id) {
      return null;
    }
    return computeEventTimingPercent(c, id);
  });

  /** Causal chain derivation for the selected event (T04, decision 3's
   * "causal chain in causal graph") — reuses `computeCausalChain`
   * (`causal-graph/causal-chain.ts`), the same `causation_id` walk the
   * causal graph's own edges are built from. null when nothing is
   * selected or the chain isn't loaded. */
  private readonly selectedCausalChain = computed(() => {
    const c = this.chain();
    const id = this.selection.selectedEventId();
    if (!c || !id) {
      return null;
    }
    return computeCausalChain(c.events, id);
  });

  readonly selectedCausalChainEntries = computed(
    () => this.selectedCausalChain()?.entries ?? []
  );

  readonly selectedCausalChainRootUnresolvedParentId = computed(
    () => this.selectedCausalChain()?.rootUnresolvedParentId ?? null
  );

  /** True when the current selection came from the "run" tab — the run
   * canvas (T05) or the step log panel embedded in it (T04); both source
   * as "run" (TraceSourceView's own doc comment). Gates the run-mode
   * inspector content (base fields + step result) AND the T06
   * `selectedEntityDeepLink` resolution below. */
  readonly isRunSelection = computed(
    () => this.selection.sourceView() === "run"
  );

  /** T05: reactive reference to the embedded run-view canvas — read-only
   * signal query, NOT a second selection signal (decision 2 forbids one).
   * Angular's viewChild query finds the component wherever it renders in
   * the template, including inside the "@if (workflowRun(); as run)"
   * branch above, and reactively becomes undefined again when that branch
   * stops rendering (a different tab, or no workflow run in the chain).
   * Used to pull RunViewComponent.selectedStepResult() (T05) and
   * .selectedStepDeepLink() (T06) — this container never fetches run data
   * itself. */
  private readonly runView = viewChild(RunViewComponent);

  /** Run-mode inspector content (T05, decision 3: "step result in run
   * view") — the selected event's step, resolved by RunViewComponent
   * from the run data IT already has loaded (real fields only). null
   * when the "run" tab isn't rendering a run canvas yet, or the selected
   * event isn't one of this run's own mapped step events (e.g. a step-log
   * entry for a chain event this run's own layout has no node for). */
  readonly runStepResult = computed(
    () => this.runView()?.selectedStepResult() ?? null
  );

  /** T06 (decision 4 + the ORCHESTRATOR RULING): "Open in Temporal" URL for
   * the selected event, rendered for EVERY mode (base "everywhere" content,
   * same as the timing/base-fields sections) — not causal-only like the old
   * "Open connector" link was. Reuses `resolveTemporalDeepLink`, extracted
   * verbatim from `message-trace.component.ts`'s `temporalUrl()` (see that
   * module's header) — same output, new call site. Rendered ONLY when the
   * selected event carries BOTH `workflow_id` AND `run_id` (T01 finding 4:
   * these two columns are only populated TOGETHER, on rule-19
   * workflow-execution-lifecycle events) — `null` otherwise, hiding the
   * link (never a broken href). */
  readonly selectedTemporalDeepLink = computed(() => {
    const event = this.selectedEvent();
    if (!event) {
      return null;
    }
    const workflowId =
      event.workflow_id !== null && event.run_id !== null
        ? event.workflow_id
        : null;
    return resolveTemporalDeepLink({
      temporalUiBaseUrl: environment.temporalUiBaseUrl,
      temporalNamespace: environment.temporalNamespace,
      workflowId,
    });
  });

  /** T06: the BUILDER deep link — per the ORCHESTRATOR RULING, always
   * `null` today (`resolve-builder-deep-link.ts`: no trace-event/run-step
   * -> builder-canvas-node id bridge exists, T01 finding 4). This computed
   * (and the template branch reading it) exist so the rendering path is
   * real code, ready for the day a real bridge lands — never synthesizing
   * a link in the meantime. */
  readonly selectedBuilderDeepLink = computed(() => resolveBuilderDeepLink());

  /** T06: the "Open <entity>" deep link for the selected event, generalized
   * from T04's causal-only `causalDeepLink` to ALL modes (base "everywhere"
   * content, per the third bullet of T06's task instructions — "keep
   * consistent" with the causal card's old "Open connector" button).
   * Run-mode selections resolve through `RunViewComponent`'s OWN
   * `selectedStepDeepLink()` (the run's `IRunEvent.payload_connector_id`/
   * `payload_agent_id` columns, via `resolve-selected-step-deep-link.ts` —
   * `ITrackedEvent.connector_id` is only populated for connector-runtime's
   * OWN `endpoint_call_completed` rows, not the run's `action_completed`
   * wrapper, so the causal-mode resolution can't reach run-mode events).
   * Waterfall/causal-mode selections resolve through
   * `resolveTrackedEventDeepLink` (T05 of
   * `manual-loops/connector-trace-linking.md`), unchanged. */
  readonly selectedEntityDeepLink = computed(() => {
    if (this.isRunSelection()) {
      return this.runView()?.selectedStepDeepLink() ?? null;
    }
    const event = this.selectedEvent();
    return event ? resolveTrackedEventDeepLink(event) : null;
  });

  constructor() {
    // Selecting a different event (from ANY view, or closing the
    // inspector) discards any in-flight/loaded payload state — the viewer
    // never carries state across events (SPEC.md
    // `manual-loops/payload-capture.md` T05: fetch on demand, never
    // pre-fetched). Migrated from `CausalGraphComponent.select()`'s reset
    // (T04) onto a signal effect, since selection now happens in sibling
    // view components via the shared service rather than a local method
    // here.
    effect(() => {
      this.selection.selectedEventId();
      this.payload.set({ kind: "idle" });
    });

    // T06 verbose logging (constraint: "Verbose logging on every new code
    // path; nothing fails silently"): logs once per selection change when
    // the Temporal deep link is hidden because the selected event doesn't
    // carry the workflow_id/run_id pair (T01 finding 4), and again when the
    // builder deep link is hidden (always, today — see
    // `resolve-builder-deep-link.ts`'s header for why).
    effect(() => {
      const event = this.selectedEvent();
      if (!event) {
        return;
      }
      if (this.selectedTemporalDeepLink() === null) {
        console.debug(
          "[TraceDetailComponent] Temporal deep link hidden — event is missing workflow_id/run_id",
          {
            eventId: event.event_id,
            workflowId: event.workflow_id,
            runId: event.run_id,
          }
        );
      }
      if (this.selectedBuilderDeepLink() === null) {
        console.debug(
          "[TraceDetailComponent] Builder deep link hidden — no trace-event -> builder-node id bridge exists (T01 finding 4)",
          { eventId: event.event_id }
        );
      }
    });
  }

  ngOnInit(): void {
    const cid = this.route.snapshot.paramMap.get("correlationId") ?? "";
    this.correlationId.set(cid);
    if (!cid) {
      return;
    }
    this.loadChain(cid);
  }

  private loadChain(correlationId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.trackingChainService.getChain(correlationId).subscribe({
      next: (c) => {
        this.chain.set(c);
        this.loading.set(false);
      },
      error: (err: { status?: number }) => {
        this.error.set(
          err?.status === 404
            ? "No tracking chain found for this correlation."
            : "Failed to load tracking chain."
        );
        this.loading.set(false);
      },
    });
  }

  /**
   * Fetches the selected event's payload on demand via
   * `TrackingChainService.getEventPayload` — never pre-fetched with the
   * chain. Maps the gateway's `payload_status`-driven HTTP responses (T04
   * of `manual-loops/payload-capture.md`: 200 body, 404
   * unresolved/none/unknown, 410 scrubbed) to view state. Migrated
   * verbatim from `CausalGraphComponent.viewPayload` (T04 of
   * `manual-loops/admin-console/console-redesign-trace.md`).
   */
  viewPayload(eventId: string): void {
    const c = this.chain();
    if (!c) {
      console.debug(
        "[TraceDetailComponent] viewPayload called with no chain loaded",
        { eventId }
      );
      return;
    }
    console.debug("[TraceDetailComponent] fetching payload on demand", {
      eventId,
      correlationId: c.correlation_id,
    });
    this.payload.set({ kind: "loading" });
    this.trackingChainService
      .getEventPayload(c.correlation_id, eventId)
      .subscribe({
        next: (response) => this.payload.set({ kind: "loaded", response }),
        error: (err: HttpErrorResponse) => {
          if (err.status === 410) {
            this.payload.set({ kind: "expired" });
            return;
          }
          if (err.status === 404) {
            // The gateway/ingester distinguish unresolved/none/unknown-event
            // only via the `error` message text (handle-payload-request.ts) —
            // surface the claim-check-specific message when detectable, else
            // a generic not-captured message.
            const reason =
              typeof err.error?.error === "string" ? err.error.error : "";
            const message = reason.includes("unresolved")
              ? "Payload was not captured (claim-check expired)"
              : "Payload was not captured";
            this.payload.set({ kind: "not-captured", message });
            return;
          }
          this.payload.set({ kind: "error" });
        },
      });
  }

  /** × button on the inspector header (T02: shell-only close path). */
  closeInspector(): void {
    console.debug("[TraceDetailComponent] inspector closed via close button", {
      selectedEventId: this.selection.selectedEventId(),
    });
    this.selection.clear();
  }

  /** Host-level Esc handler (T02) — clears the selection when the
   * inspector is open; a no-op otherwise. */
  onEscape(): void {
    if (this.selection.selectedEventId() === null) {
      return;
    }
    console.debug("[TraceDetailComponent] inspector closed via Esc", {
      selectedEventId: this.selection.selectedEventId(),
    });
    this.selection.clear();
  }
}
