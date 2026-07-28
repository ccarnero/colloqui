import type { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { AuthService } from "../../../core/services/auth.service";
import {
  type IEventPayloadResponse,
  TrackingChainService,
} from "../../../core/services/tracking-chain.service";
import { projectHttpPayload } from "../../processes/run-view/domain/project-http-payload";
import { projectExecutionPayload } from "./domain/project-execution-payload";
import { projectLlmPayload } from "./domain/project-llm-payload";
import { projectMcpPayload } from "./domain/project-mcp-payload";

/** Tenant-admin permission gating the payload viewer — same guard the trace
 * inspector uses (`trace-detail.component.ts:43`, SPEC.md
 * `manual-loops/payload-capture.md` T05). */
const PAYLOAD_PERMISSION = "tracking:payload:read";

/** Event `kind` values this inspector knows how to project (decision 7 of
 * `manual-loops/connectors/connection-call-inspector.md`). Any other kind
 * falls back to the raw pretty-printed payload (forward-compatible
 * default). */
const KIND_HTTP = "endpoint_call_completed";
const KIND_MCP = "mcp_call_completed";
const KIND_EXECUTION = "execution_completed";
const KIND_LLM = "llm_call_completed";

/** Input contract for a "Recent calls" row that can open this inspector
 * (SPEC.md T07: "event_id + correlation_id + kind + scalars"). `scalars`
 * carries whatever quick summary fields the calling list already has (e.g.
 * method/status for HTTP) — shown immediately, independent of the
 * `tracking:payload:read` gate, since the list itself is already
 * scalar-only and requires no special permission. */
export interface ICallInspectorRow {
  readonly eventId: string;
  readonly correlationId: string;
  readonly kind: string | null;
  readonly scalars?: Readonly<Record<string, string | number | boolean | null>>;
}

/** On-demand payload fetch view-state, reset every time `row()` changes
 * (never carried across calls — SPEC.md "never pre-fetched with the
 * list"). Mirrors `trace-detail.component.ts`'s `PayloadViewState`. */
type PayloadViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly response: IEventPayloadResponse }
  | { readonly kind: "expired" }
  | { readonly kind: "not-captured"; readonly message: string }
  | { readonly kind: "error" };

/**
 * Shared docked call inspector (`manual-loops/connectors/connection-call-inspector.md`
 * T07) — a right-docked panel, pattern copied from the trace event
 * inspector shell (`features/processes/trace/trace-detail.component.ts:242-521`,
 * `.td-inspector`/`.td-inspector-head`/`.td-inspector-body` classes renamed
 * here `.ci-*`). Spacing/chip styling follows the design contract's
 * Connection detail section (`manual-loops/admin-console/design/Rediseño
 * Terminal.dc.html`): the kind badge chip (line 1197), the recent-calls
 * status chip (lines 1242-1247), and the config `dl` key/value rows (lines
 * 1215-1221).
 *
 * Consumers (T08-T11) set `row()` to the clicked call and listen to
 * `close` — this component owns NO navigation/selection state of its own,
 * mirroring the trace inspector's "container owns selection, presentation
 * component is dumb" split, except here the row IS the selection (no
 * shared selection service exists across the four different connection
 * detail screens this inspector will be embedded in).
 */
@Component({
  selector: "app-call-inspector",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="ci-inspector" aria-label="Call inspector">
      @if (row(); as r) {
        <header class="ci-head">
          <div class="ci-head-main">
            <span class="ci-title">Call · {{ r.eventId }}</span>
            <!-- kind badge chip, Rediseño Terminal.dc.html:1197 -->
            <span class="ci-kind-chip">{{ r.kind ?? "unknown" }}</span>
          </div>
          <button
            type="button"
            class="ci-close"
            aria-label="Close inspector"
            (click)="onClose()"
          >
            ×
          </button>
        </header>

        <div class="ci-body">
          @if (scalarEntries().length > 0) {
            <dl class="ci-scalars">
              @for (entry of scalarEntries(); track entry.label) {
                <dt>{{ entry.label }}</dt>
                <dd>{{ entry.value }}</dd>
              }
            </dl>
          }

          @if (!canViewPayload()) {
            <p class="ci-hint">
              🔒 Payload requires the tracking:payload:read permission.
            </p>
          } @else {
            @switch (payloadState().kind) {
              @case ("loading") {
                <p class="ci-status">Loading payload…</p>
              }
              @case ("expired") {
                <p class="ci-status">Payload expired (30-day retention)</p>
              }
              @case ("not-captured") {
                <p class="ci-status">{{ notCapturedMessage() }}</p>
              }
              @case ("error") {
                <p class="ci-status ci-status--error">
                  Failed to load payload.
                </p>
              }
              @case ("loaded") {
                @if (isHttpKind()) {
                  <section class="ci-section" aria-label="Request">
                    <h4 class="ci-section-title">Request</h4>
                    <dl class="ci-rows">
                      @for (row2 of httpRequest().rows; track row2.label) {
                        <dt>{{ row2.label }}</dt>
                        <dd>{{ row2.value }}</dd>
                      }
                    </dl>
                    @if (httpRequest().headers; as headers) {
                      <pre class="ci-pre">{{ headers }}</pre>
                    }
                    @if (httpRequest().body; as body) {
                      <pre class="ci-pre">{{ body }}</pre>
                    }
                  </section>
                  <section class="ci-section" aria-label="Response">
                    <h4 class="ci-section-title">Response</h4>
                    <dl class="ci-rows">
                      @for (row3 of httpResponse().rows; track row3.label) {
                        <dt>{{ row3.label }}</dt>
                        <dd>{{ row3.value }}</dd>
                      }
                    </dl>
                    @if (httpResponse().headers; as headers) {
                      <pre class="ci-pre">{{ headers }}</pre>
                    }
                    @if (httpResponse().body; as body) {
                      <pre class="ci-pre">{{ body }}</pre>
                    }
                  </section>
                } @else if (isMcpKind()) {
                  <section class="ci-section" aria-label="MCP call">
                    <h4 class="ci-section-title">MCP call</h4>
                    <dl class="ci-rows">
                      @if (mcpPayload().toolName; as v) {
                        <dt>tool</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (mcpPayload().serverName; as v) {
                        <dt>server</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (mcpPayload().success !== null) {
                        <dt>success</dt>
                        <dd>{{ mcpPayload().success }}</dd>
                      }
                      @if (mcpPayload().durationMs; as v) {
                        <dt>duration</dt>
                        <dd>{{ v }} ms</dd>
                      }
                      @if (mcpPayload().error; as v) {
                        <dt>error</dt>
                        <dd>{{ v }}</dd>
                      }
                    </dl>
                    @if (mcpPayload().argumentsJson; as v) {
                      <h5 class="ci-subtitle">Arguments</h5>
                      <pre class="ci-pre">{{ v }}</pre>
                    }
                    @if (mcpPayload().resultJson; as v) {
                      <h5 class="ci-subtitle">Result</h5>
                      <pre class="ci-pre">{{ v }}</pre>
                    }
                  </section>
                } @else if (isExecutionKind()) {
                  <section class="ci-section" aria-label="Agent execution">
                    <h4 class="ci-section-title">Agent execution</h4>
                    <dl class="ci-rows">
                      @if (executionPayload().model; as v) {
                        <dt>model</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (executionPayload().provider; as v) {
                        <dt>provider</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (executionPayload().inputTokens; as v) {
                        <dt>input tokens</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (executionPayload().outputTokens; as v) {
                        <dt>output tokens</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (executionPayload().costUsd; as v) {
                        <dt>cost</dt>
                        <dd>\${{ v }}</dd>
                      }
                    </dl>
                    @if (executionPayload().messageIn; as v) {
                      <h5 class="ci-subtitle">Message in</h5>
                      <pre class="ci-pre">{{ v }}</pre>
                    } @else {
                      <p class="ci-muted">
                        Message in not captured for this execution.
                      </p>
                    }
                    @if (executionPayload().replyText; as v) {
                      <h5 class="ci-subtitle">Reply</h5>
                      <pre class="ci-pre">{{ v }}</pre>
                    }
                    @if (executionPayload().toolCallsJson; as v) {
                      <h5 class="ci-subtitle">Tool calls</h5>
                      <pre class="ci-pre">{{ v }}</pre>
                    }
                    @if (executionPayload().toolResultsJson; as v) {
                      <h5 class="ci-subtitle">Tool results</h5>
                      <pre class="ci-pre">{{ v }}</pre>
                    }
                  </section>
                } @else if (isLlmKind()) {
                  <section class="ci-section" aria-label="LLM call">
                    <h4 class="ci-section-title">LLM call</h4>
                    <dl class="ci-rows">
                      @if (llmPayload().model; as v) {
                        <dt>model</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (llmPayload().provider; as v) {
                        <dt>provider</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (llmPayload().durationMs; as v) {
                        <dt>duration</dt>
                        <dd>{{ v }} ms</dd>
                      }
                      @if (llmPayload().inputTokens; as v) {
                        <dt>input tokens</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (llmPayload().outputTokens; as v) {
                        <dt>output tokens</dt>
                        <dd>{{ v }}</dd>
                      }
                      @if (llmPayload().costUsd; as v) {
                        <dt>cost</dt>
                        <dd>\${{ v }}</dd>
                      }
                    </dl>
                    @if (llmPayload().prompt; as v) {
                      <h5 class="ci-subtitle">Prompt</h5>
                      <pre class="ci-pre">{{ v }}</pre>
                    }
                    @if (llmPayload().completion; as v) {
                      <h5 class="ci-subtitle">Completion</h5>
                      <pre class="ci-pre">{{ v }}</pre>
                    }
                  </section>
                } @else {
                  <!-- Unknown kinds: raw pretty-printed payload
                       (forward-compatible default, SPEC.md T07). -->
                  <section class="ci-section" aria-label="Raw payload">
                    <h4 class="ci-section-title">Raw payload</h4>
                    <pre class="ci-pre">{{ rawPayloadJson() }}</pre>
                  </section>
                }
              }
              @default {
                <p class="ci-status">Loading payload…</p>
              }
            }
          }
        </div>
      } @else {
        <div class="ci-body ci-body--empty">
          <p class="ci-empty">Select a call…</p>
        </div>
      }
    </aside>
  `,
  styles: `
    :host {
      display: block;
    }
    .ci-inspector {
      flex: 0 0 320px;
      border: 1px solid var(--rd-line-3, #2e2e2e);
      border-radius: var(--rd-radius-11, 14px);
      overflow: hidden;
      background: var(--rd-bg, #0a0a0a);
      position: sticky;
      top: 16px;
    }
    .ci-head {
      display: flex;
      align-items: center;
      gap: var(--rd-space-5, 9px);
      padding: var(--rd-space-7, 13px) var(--rd-space-8, 16px);
      border-bottom: 1px solid var(--rd-line, #1f1f1f);
    }
    .ci-head-main {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--rd-space-4, 8px);
    }
    .ci-title {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-base, 13px);
      font-weight: 600;
      color: var(--rd-text-1, #ededed);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Kind badge chip — Rediseño Terminal.dc.html:1197 (kind · sub chip). */
    .ci-kind-chip {
      font-family: var(--rd-font-mono);
      font-size: 11px;
      border: 1px solid var(--rd-line-3, #2e2e2e);
      border-radius: 6px;
      padding: 2px 9px;
      color: var(--rd-text-2, #a1a1a1);
      flex-shrink: 0;
    }
    .ci-close {
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
    .ci-close:hover {
      background: var(--rd-hover, #1a1a1a);
    }
    .ci-body {
      padding: var(--rd-space-7, 14px) var(--rd-space-8, 16px);
    }
    .ci-body--empty {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
    }
    .ci-empty {
      margin: 0;
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-sm, 12px);
    }
    .ci-scalars,
    .ci-rows {
      /* Config dl rows — Rediseño Terminal.dc.html:1215-1221. */
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--rd-space-3, 6px) var(--rd-space-5, 10px);
      margin: 0 0 var(--rd-space-6, 12px);
      font-size: var(--rd-text-size-sm, 12px);
    }
    .ci-scalars dt,
    .ci-rows dt {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--rd-text-3, #7a7a7a);
    }
    .ci-scalars dd,
    .ci-rows dd {
      margin: 0;
      font-family: var(--rd-font-mono);
      color: var(--rd-text-1, #ededed);
      word-break: break-all;
    }
    .ci-hint,
    .ci-status,
    .ci-muted {
      margin: 0;
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-sm, 12px);
    }
    .ci-status--error {
      color: var(--rd-red, #ff6b6b);
    }
    .ci-section {
      margin-top: var(--rd-space-6, 12px);
      padding-top: var(--rd-space-6, 12px);
      border-top: 1px solid var(--rd-line-2, #161616);
    }
    .ci-section:first-of-type {
      margin-top: 0;
      padding-top: 0;
      border-top: none;
    }
    .ci-section-title {
      margin: 0 0 var(--rd-space-4, 8px);
      font-size: var(--rd-text-size-sm, 12px);
      font-weight: 600;
      color: var(--rd-text-1, #ededed);
    }
    .ci-subtitle {
      margin: var(--rd-space-4, 8px) 0 var(--rd-space-3, 6px);
      font-size: var(--rd-text-size-sm, 12px);
      font-weight: 500;
      color: var(--rd-text-2, #a1a1a1);
    }
    .ci-pre {
      margin: 0;
      padding: var(--rd-space-4, 8px);
      background: var(--rd-panel, #141414);
      border-radius: var(--rd-radius-5, 6px);
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
      font-size: var(--rd-text-size-2xs, 11px);
    }
  `,
})
export class CallInspectorComponent {
  private readonly auth = inject(AuthService);
  private readonly trackingChainService = inject(TrackingChainService);

  /** The currently-open call row, or `null` when the inspector is closed —
   * the consumer owns this state and passes it down (SPEC.md T07: "Input:
   * a call row"). */
  readonly row = input<ICallInspectorRow | null>(null);

  /** Emitted when the user clicks the × close button. Consumers clear
   * `row()` in response (same contract as `trace-detail.component.ts`'s
   * `closeInspector()`). */
  readonly close = output<void>();

  readonly canViewPayload = computed(() =>
    this.auth.hasPermission(PAYLOAD_PERMISSION)
  );

  private readonly payload = signal<PayloadViewState>({ kind: "idle" });
  readonly payloadState = computed(() => this.payload());

  private readonly loadedResponse = computed<IEventPayloadResponse | null>(
    () => {
      const state = this.payload();
      return state.kind === "loaded" ? state.response : null;
    }
  );

  readonly notCapturedMessage = computed(() => {
    const state = this.payload();
    return state.kind === "not-captured" ? state.message : "";
  });

  readonly scalarEntries = computed(() => {
    const scalars = this.row()?.scalars;
    if (!scalars) {
      return [];
    }
    return Object.entries(scalars)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([label, value]) => ({ label, value: String(value) }));
  });

  readonly isHttpKind = computed(() => this.row()?.kind === KIND_HTTP);
  readonly isMcpKind = computed(() => this.row()?.kind === KIND_MCP);
  readonly isExecutionKind = computed(
    () => this.row()?.kind === KIND_EXECUTION
  );
  readonly isLlmKind = computed(() => this.row()?.kind === KIND_LLM);

  /** HTTP request/response projections — REUSE of
   * `project-http-payload.ts` (SPEC constraint: "do not duplicate"), the
   * same projection `run-view-popup.component.ts` uses for its HTTP
   * request/response viewer. */
  readonly httpRequest = computed(() =>
    projectHttpPayload(this.loadedResponse()?.payload, "request")
  );
  readonly httpResponse = computed(() =>
    projectHttpPayload(this.loadedResponse()?.payload, "response")
  );

  readonly mcpPayload = computed(() =>
    projectMcpPayload(this.loadedResponse()?.payload)
  );
  readonly executionPayload = computed(() =>
    projectExecutionPayload(this.loadedResponse()?.payload)
  );
  readonly llmPayload = computed(() =>
    projectLlmPayload(this.loadedResponse()?.payload)
  );

  readonly rawPayloadJson = computed(() => {
    const response = this.loadedResponse();
    return response ? JSON.stringify(response.payload, null, 2) : "";
  });

  constructor() {
    // On-demand fetch, triggered ONLY by opening the inspector (SPEC.md
    // T07: "On open it fetches the payload on demand ... never pre-fetched
    // with the list"). Reset to idle when the row closes (row -> null) or
    // changes to a different call, so stale payload state never leaks
    // across calls (same discard-on-change contract as
    // `trace-detail.component.ts`'s selection-change effect).
    effect(() => {
      const r = this.row();
      if (!r) {
        this.payload.set({ kind: "idle" });
        return;
      }
      if (!this.canViewPayload()) {
        console.debug(
          "[CallInspectorComponent] payload fetch skipped — missing tracking:payload:read permission",
          { eventId: r.eventId }
        );
        this.payload.set({ kind: "idle" });
        return;
      }
      this.fetchPayload(r);
    });
  }

  private fetchPayload(r: ICallInspectorRow): void {
    console.debug("[CallInspectorComponent] fetching payload on demand", {
      eventId: r.eventId,
      correlationId: r.correlationId,
      kind: r.kind,
    });
    this.payload.set({ kind: "loading" });
    this.trackingChainService
      .getEventPayload(r.correlationId, r.eventId)
      .subscribe({
        next: (response) => this.payload.set({ kind: "loaded", response }),
        error: (err: HttpErrorResponse) => {
          if (err.status === 410) {
            this.payload.set({ kind: "expired" });
            return;
          }
          if (err.status === 404) {
            // Mirrors handle-payload-request.ts's error-text distinction
            // (`unresolved` vs `none`) — same mapping as
            // `trace-detail.component.ts`'s `viewPayload`.
            const reason =
              typeof err.error?.error === "string" ? err.error.error : "";
            const message = reason.includes("unresolved")
              ? "Payload was not captured (claim-check expired)"
              : "Payload was not captured";
            this.payload.set({ kind: "not-captured", message });
            return;
          }
          console.debug("[CallInspectorComponent] payload fetch failed", {
            eventId: r.eventId,
            status: err.status,
          });
          this.payload.set({ kind: "error" });
        },
      });
  }

  /** × button — consumers clear `row()` in response to `close`. */
  onClose(): void {
    console.debug("[CallInspectorComponent] close requested", {
      eventId: this.row()?.eventId ?? null,
    });
    this.close.emit();
  }
}
