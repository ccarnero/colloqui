import type { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import type { IAgent } from "../../../core/models/agent.model";
import type { IChannelAccount } from "../../../core/models/channel-account.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { AuthService } from "../../../core/services/auth.service";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";
import type { IConnectorCall } from "../../../core/services/connector-call.service";
import { ConnectorCallService } from "../../../core/services/connector-call.service";
import type { IAdapterDto } from "../../../core/services/http-adapter.service";
import { HttpAdapterService } from "../../../core/services/http-adapter.service";
import type { IRunResponse } from "../../../core/services/run-view.service";
import type { IEventPayloadResponse } from "../../../core/services/tracking-chain.service";
import { TrackingChainService } from "../../../core/services/tracking-chain.service";
import type { IWorkflowDefinitionDto } from "../../automation/workflows/services/workflow-api.service";
import {
  type IStepEventPair,
  parseNodeId,
  resolveStepEvents,
} from "./domain/resolve-step-events";
import type { ILayoutNode } from "./domain/run-view.model";
import {
  agentDeepLink,
  channelDeepLink,
  computeAnchorPosition,
  connectorDeepLink,
  formatPopupStatusLabel,
  type IAnchorRect,
  type PeekKind,
  resolvePeekKind,
  workflowDeepLink,
} from "./run-view-popup-render";

/** Same tenant-admin permission gate `causal-graph.component.ts` uses for
 * its payload viewer (SPEC.md `manual-loops/payload-capture.md` T05) —
 * T05 of `manual-loops/run-view.md` reuses it verbatim for the popup's
 * request/response section. */
const PAYLOAD_PERMISSION = "tracking:payload:read";

const POPUP_WIDTH = 380;
const POPUP_HEIGHT = 460;

type PopupView =
  | { readonly kind: "step-detail" }
  | { readonly kind: "peek-connector"; readonly adapterId: string }
  | { readonly kind: "peek-agent"; readonly agentId: string }
  | { readonly kind: "peek-channel"; readonly accountId: string }
  | { readonly kind: "peek-workflow" };

type PeekState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly value: T }
  | { readonly kind: "error" };

// TODO(run-view T05 follow-up): `PayloadViewState` and the `viewPayload`
// flow below are copy-pasted from `causal-graph.component.ts`'s payload
// viewer (same states, same `TrackingChainService` call shape). Worth
// extracting into a shared helper/service once a third consumer shows up
// or the two drift — not done here to avoid an over-engineered
// abstraction for two call sites.
type PayloadViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly response: IEventPayloadResponse }
  | { readonly kind: "expired" }
  | { readonly kind: "not-captured"; readonly message: string }
  | { readonly kind: "error" };

/**
 * Anchored step popup (T05 of `manual-loops/run-view.md`): opened by
 * `run-view.component.ts` when a flow node is clicked. Shows the step
 * detail contract (identity, rows, events pair, req/resp payload states)
 * plus peek sub-views that QUOTE existing feature services — never a
 * second copy of those screens (DESIGN.md: "Peeks QUOTE data; they never
 * duplicate screens") — with an "Open in <feature>" deep-link out.
 */
@Component({
  selector: "app-run-view-popup",
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "(keydown.escape)": "close()",
    "(keydown.tab)": "onTab($event)",
  },
  template: `
    <div class="rvp-overlay" (click)="close()"></div>
    <div
      #panel
      class="rvp-panel"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'Step detail: ' + node().stepName"
      [style.top.px]="position().top"
      [style.left.px]="position().left"
      (click)="$event.stopPropagation()"
    >
      <header class="rvp-header">
        @if (view().kind !== "step-detail") {
          <button
            type="button"
            class="rvp-back"
            aria-label="Back"
            (click)="back()"
          >
            ←
          </button>
        }
        <h3 class="rvp-title">{{ headerTitle() }}</h3>
        <button
          type="button"
          class="rvp-close"
          aria-label="Close"
          (click)="close()"
        >
          ×
        </button>
      </header>

      <div class="rvp-body">
        @switch (view().kind) {
          @case ("step-detail") {
            <dl class="rvp-rows">
              <dt>name</dt>
              <dd>{{ node().stepName }}</dd>
              <dt>type</dt>
              <dd>{{ node().actionType ?? node().kind }}</dd>
              @if (node().instanceId) {
                <dt>instance</dt>
                <dd class="rvp-mono">{{ node().instanceId }}</dd>
              }
              <dt>status</dt>
              <dd>{{ statusLabel() }}</dd>
              @if (node().durationMs !== null) {
                <dt>duration</dt>
                <dd>{{ node().durationMs }} ms</dd>
              }
              @if (node().branchTaken !== null) {
                <dt>branch</dt>
                <dd>{{ node().branchTaken }}</dd>
              }
              <dt>action index</dt>
              <dd>{{ actionIndex() }}</dd>
            </dl>

            <section class="rvp-events">
              <h4 class="rvp-subtitle">Events</h4>
              <dl class="rvp-rows">
                <dt>started</dt>
                <dd class="rvp-mono">
                  {{ eventPair().started?.eventId ?? "—" }}
                  @if (eventPair().started) {
                    · {{ eventPair().started?.occurredAt }}
                  }
                </dd>
                <dt>completed</dt>
                <dd class="rvp-mono">
                  {{ eventPair().completed?.eventId ?? "—" }}
                  @if (eventPair().completed) {
                    · {{ eventPair().completed?.occurredAt }}
                  }
                </dd>
              </dl>
            </section>

            <section class="rvp-payload">
              <h4 class="rvp-subtitle">Request / response</h4>
              @if (!canViewPayload()) {
                <p class="rvp-status">
                  🔒 Payload requires the tracking:payload:read permission.
                </p>
              } @else {
                <div class="rvp-payload-actions">
                  @if (eventPair().started) {
                    <button
                      type="button"
                      class="rvp-payload-btn"
                      (click)="viewPayload('request', eventPair().started!.eventId)"
                    >
                      View request
                    </button>
                  }
                  @if (eventPair().completed) {
                    <button
                      type="button"
                      class="rvp-payload-btn"
                      (click)="viewPayload('response', eventPair().completed!.eventId)"
                    >
                      View response
                    </button>
                  }
                </div>
                @switch (payloadState().kind) {
                  @case ("loading") {
                    <p class="rvp-status">Loading payload…</p>
                  }
                  @case ("expired") {
                    <p class="rvp-status">
                      Payload expired (30-day retention)
                    </p>
                  }
                  @case ("not-captured") {
                    <p class="rvp-status">{{ notCapturedMessage() }}</p>
                  }
                  @case ("error") {
                    <p class="rvp-status rvp-status-error">
                      Failed to load payload.
                    </p>
                  }
                  @case ("loaded") {
                    <details class="rvp-payload-details">
                      <summary>
                        {{ payloadLabel() }} ({{ loadedResponse()?.payload_status }})
                      </summary>
                      <pre class="rvp-payload-pre">{{ payloadJson() }}</pre>
                    </details>
                  }
                }
              }
            </section>

            @if (peekKind(); as kind) {
              <section class="rvp-peek-actions">
                <button
                  type="button"
                  class="rvp-peek-btn"
                  (click)="openPeek(kind)"
                >
                  @switch (kind) {
                    @case ("connector") {
                      View connector profile
                    }
                    @case ("agent") {
                      View agent profile
                    }
                    @case ("channel") {
                      View channel account
                    }
                  }
                </button>
              </section>
            }

            @if (workflowId()) {
              <section class="rvp-peek-actions">
                <button
                  type="button"
                  class="rvp-peek-btn"
                  (click)="openWorkflowPeek()"
                >
                  View workflow definition
                </button>
              </section>
            }
          }

          @case ("peek-connector") {
            @if (connectorPeek(); as cp) {
              @switch (cp.kind) {
                @case ("loading") {
                  <p class="rvp-status" role="status">Loading connector…</p>
                }
                @case ("error") {
                  <p class="rvp-status rvp-status-error" role="alert">
                    Failed to load connector.
                  </p>
                }
                @case ("loaded") {
                  <dl class="rvp-rows">
                    <dt>name</dt>
                    <dd>{{ cp.value.adapter.name }}</dd>
                    <dt>base URL</dt>
                    <dd class="rvp-mono">{{ cp.value.adapter.baseUrl }}</dd>
                    <dt>status</dt>
                    <dd>{{ cp.value.adapter.status }}</dd>
                    <dt>cache</dt>
                    <dd>
                      {{
                        cp.value.adapter.defaultCache?.enabled
                          ? "enabled"
                          : "disabled"
                      }}
                    </dd>
                  </dl>
                  <h4 class="rvp-subtitle">Recent calls</h4>
                  @if (cp.value.recentCalls.length) {
                    <ul class="rvp-list">
                      @for (
                        call of cp.value.recentCalls;
                        track call.timestamp + call.resolvedUrl
                      ) {
                        <li>
                          {{ call.method }} {{ call.status }} ·
                          {{ call.durationMs }} ms ·
                          {{ call.cacheResult ?? "no cache" }}
                        </li>
                      }
                    </ul>
                  } @else {
                    <p class="rvp-status">No recent calls in the last hour.</p>
                  }
                  <footer class="rvp-peek-footer">
                    <a
                      class="rvp-deep-link"
                      [routerLink]="connectorLink()"
                      (click)="close()"
                    >
                      Open in Connectors →
                    </a>
                  </footer>
                }
              }
            }
          }

          @case ("peek-agent") {
            @if (agentPeek(); as ap) {
              @switch (ap.kind) {
                @case ("loading") {
                  <p class="rvp-status" role="status">Loading agent…</p>
                }
                @case ("error") {
                  <p class="rvp-status rvp-status-error" role="alert">
                    Failed to load agent.
                  </p>
                }
                @case ("loaded") {
                  <dl class="rvp-rows">
                    <dt>name</dt>
                    <dd>{{ ap.value.name }}</dd>
                    <dt>status</dt>
                    <dd>{{ ap.value.status }}</dd>
                    <dt>model</dt>
                    <dd>
                      {{
                        ap.value.model_config.llm?.model ??
                          ap.value.model_config.model ??
                          "—"
                      }}
                    </dd>
                  </dl>
                  <h4 class="rvp-subtitle">Recent runs</h4>
                  <p class="rvp-status">
                    Recent-run history is not available yet — the runtime
                    service exposes no execution-listing endpoint (finding,
                    not a workaround; T05 quotes existing services only).
                  </p>
                  <footer class="rvp-peek-footer">
                    <a
                      class="rvp-deep-link"
                      [routerLink]="agentLink()"
                      (click)="close()"
                    >
                      Open in Agents →
                    </a>
                  </footer>
                }
              }
            }
          }

          @case ("peek-channel") {
            @if (channelPeek(); as chp) {
              @switch (chp.kind) {
                @case ("loading") {
                  <p class="rvp-status" role="status">
                    Loading channel account…
                  </p>
                }
                @case ("error") {
                  <p class="rvp-status rvp-status-error" role="alert">
                    Failed to load channel account.
                  </p>
                }
                @case ("loaded") {
                  <dl class="rvp-rows">
                    <dt>name</dt>
                    <dd>{{ chp.value.name }}</dd>
                    <dt>channel</dt>
                    <dd>{{ chp.value.channel }}</dd>
                    <dt>provider</dt>
                    <dd>{{ chp.value.provider }}</dd>
                    <dt>active</dt>
                    <dd>{{ chp.value.isActive ? "yes" : "no" }}</dd>
                  </dl>
                  <footer class="rvp-peek-footer">
                    <a
                      class="rvp-deep-link"
                      [routerLink]="channelLink()"
                      (click)="close()"
                    >
                      Open in Channels →
                    </a>
                  </footer>
                }
              }
            }
          }

          @case ("peek-workflow") {
            <dl class="rvp-rows">
              <dt>name</dt>
              <dd>{{ definition()?.name }}</dd>
              <dt>application</dt>
              <dd>{{ definition()?.application }}</dd>
              <dt>actions</dt>
              <dd>{{ definition()?.actions?.length ?? 0 }}</dd>
            </dl>
            <footer class="rvp-peek-footer">
              <a
                class="rvp-deep-link"
                [routerLink]="workflowLink()"
                (click)="close()"
              >
                Open in Workflow builder →
              </a>
            </footer>
          }
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .rvp-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.15);
      z-index: 1000;
    }
    .rvp-panel {
      position: fixed;
      z-index: 1001;
      width: 380px;
      max-height: 460px;
      overflow-y: auto;
      background: var(--bg, #fff);
      border: 1px solid var(--border, #185fa5);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      font-size: 12px;
    }
    .rvp-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle, #ddd);
    }
    .rvp-title {
      flex: 1 1 auto;
      margin: 0;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rvp-back,
    .rvp-close {
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 2px 6px;
    }
    .rvp-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .rvp-rows {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 8px;
      margin: 0;
    }
    .rvp-rows dt {
      color: var(--text3, #888);
    }
    .rvp-rows dd {
      margin: 0;
      word-break: break-all;
    }
    .rvp-mono {
      font-family: var(--font-mono, monospace);
    }
    .rvp-subtitle {
      margin: 0 0 4px;
      font-size: 12px;
    }
    .rvp-status {
      margin: 0;
      color: var(--text3, #888);
    }
    .rvp-status-error {
      color: var(--red, #b3261e);
    }
    .rvp-payload-actions {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    .rvp-payload-btn,
    .rvp-peek-btn {
      padding: 4px 10px;
      font-size: 12px;
      border: 1px solid var(--border, #185fa5);
      border-radius: 6px;
      background: var(--bg, #fff);
      color: #185fa5;
      cursor: pointer;
    }
    .rvp-payload-details {
      margin-top: 6px;
    }
    .rvp-payload-pre {
      margin: 6px 0 0;
      padding: 8px;
      background: var(--bg2, #f8f9fa);
      border-radius: 6px;
      max-height: 160px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .rvp-peek-actions {
      display: flex;
    }
    .rvp-list {
      margin: 0;
      padding-left: 16px;
    }
    .rvp-peek-footer {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border-subtle, #ddd);
    }
    .rvp-deep-link {
      color: #185fa5;
      font-weight: 500;
    }
  `,
})
export class RunViewPopupComponent {
  private readonly auth = inject(AuthService);
  private readonly trackingChainService = inject(TrackingChainService);
  private readonly httpAdapterService = inject(HttpAdapterService);
  private readonly connectorCallService = inject(ConnectorCallService);
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly channelAdminService = inject(ChannelAdminService);

  readonly run = input.required<IRunResponse>();
  readonly node = input.required<ILayoutNode>();
  readonly anchorRect = input.required<IAnchorRect>();
  readonly definition = input<IWorkflowDefinitionDto | null>(null);

  readonly closed = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>("panel");

  private readonly stack = signal<readonly PopupView[]>([
    { kind: "step-detail" },
  ]);
  readonly view = computed<PopupView>(
    () => this.stack()[this.stack().length - 1] ?? { kind: "step-detail" }
  );

  readonly workflowId = computed(() => this.run().workflow_id);

  readonly statusLabel = computed(() =>
    formatPopupStatusLabel(this.node().status)
  );

  readonly actionIndex = computed(() => {
    const { actionIndex } = parseNodeId(this.node().id);
    return actionIndex !== null ? String(actionIndex) : "—";
  });

  readonly eventPair = computed<IStepEventPair>(() =>
    resolveStepEvents(this.node(), this.run().events)
  );

  readonly peekKind = computed<PeekKind>(() => resolvePeekKind(this.node()));

  readonly canViewPayload = computed(() =>
    this.auth.hasPermission(PAYLOAD_PERMISSION)
  );

  private readonly payload = signal<PayloadViewState>({ kind: "idle" });
  readonly payloadState = computed(() => this.payload());
  private readonly payloadLabelSig = signal<string>("");
  readonly payloadLabel = computed(() => this.payloadLabelSig());

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

  private readonly connectorPeekState = signal<
    PeekState<{ adapter: IAdapterDto; recentCalls: IConnectorCall[] }>
  >({ kind: "loading" });
  readonly connectorPeek = computed(() => this.connectorPeekState());

  private readonly agentPeekState = signal<PeekState<IAgent>>({
    kind: "loading",
  });
  readonly agentPeek = computed(() => this.agentPeekState());

  private readonly channelPeekState = signal<PeekState<IChannelAccount>>({
    kind: "loading",
  });
  readonly channelPeek = computed(() => this.channelPeekState());

  readonly headerTitle = computed(() => {
    const v = this.view();
    if (v.kind === "step-detail") {
      return this.node().stepName;
    }
    if (v.kind === "peek-connector") {
      return "Connector profile";
    }
    if (v.kind === "peek-agent") {
      return "Agent profile";
    }
    if (v.kind === "peek-channel") {
      return "Channel account";
    }
    return "Workflow definition";
  });

  readonly connectorLink = computed(() => {
    const v = this.view();
    return v.kind === "peek-connector" ? connectorDeepLink(v.adapterId) : [];
  });
  readonly agentLink = computed(() => {
    const v = this.view();
    return v.kind === "peek-agent" ? agentDeepLink(v.agentId) : [];
  });
  readonly channelLink = computed(() => {
    const account = this.channelPeekState();
    const v = this.view();
    return v.kind === "peek-channel" && account.kind === "loaded"
      ? channelDeepLink(account.value.channel, v.accountId)
      : [];
  });
  readonly workflowLink = computed(() => workflowDeepLink(this.workflowId()));

  readonly position = computed(() =>
    computeAnchorPosition(
      this.anchorRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { width: POPUP_WIDTH, height: POPUP_HEIGHT }
    )
  );

  constructor() {
    // Focus the panel whenever it (re)opens, so keyboard users land inside
    // the trap immediately (WAI-ARIA dialog pattern).
    effect(() => {
      this.node();
      queueMicrotask(() => this.panel()?.nativeElement.focus());
    });
  }

  close(): void {
    this.closed.emit();
  }

  back(): void {
    const current = this.stack();
    if (current.length > 1) {
      this.stack.set(current.slice(0, -1));
    }
  }

  openPeek(kind: PeekKind): void {
    const instanceId = this.node().instanceId;
    if (!instanceId || !kind) {
      return;
    }
    if (kind === "connector") {
      this.stack.set([
        ...this.stack(),
        { kind: "peek-connector", adapterId: instanceId },
      ]);
      this.fetchConnectorPeek(instanceId);
      return;
    }
    if (kind === "agent") {
      this.stack.set([
        ...this.stack(),
        { kind: "peek-agent", agentId: instanceId },
      ]);
      this.fetchAgentPeek(instanceId);
      return;
    }
    this.stack.set([
      ...this.stack(),
      { kind: "peek-channel", accountId: instanceId },
    ]);
    this.fetchChannelPeek(instanceId);
  }

  openWorkflowPeek(): void {
    this.stack.set([...this.stack(), { kind: "peek-workflow" }]);
  }

  private fetchConnectorPeek(adapterId: string): void {
    this.connectorPeekState.set({ kind: "loading" });
    this.httpAdapterService.get(adapterId).subscribe({
      next: (adapter) => {
        this.connectorCallService.recentCalls(adapterId).subscribe({
          next: (recentCalls) =>
            this.connectorPeekState.set({
              kind: "loaded",
              value: { adapter, recentCalls },
            }),
          error: () =>
            this.connectorPeekState.set({
              kind: "loaded",
              value: { adapter, recentCalls: [] },
            }),
        });
      },
      error: () => this.connectorPeekState.set({ kind: "error" }),
    });
  }

  private fetchAgentPeek(agentId: string): void {
    this.agentPeekState.set({ kind: "loading" });
    this.agentAdminService.getAgent(agentId).subscribe({
      next: (agent) =>
        this.agentPeekState.set({ kind: "loaded", value: agent }),
      error: () => this.agentPeekState.set({ kind: "error" }),
    });
  }

  private fetchChannelPeek(accountId: string): void {
    this.channelPeekState.set({ kind: "loading" });
    this.channelAdminService.listAccounts().subscribe({
      next: (accounts) => {
        const found = accounts.find((a) => a.id === accountId);
        if (found) {
          this.channelPeekState.set({ kind: "loaded", value: found });
        } else {
          this.channelPeekState.set({ kind: "error" });
        }
      },
      error: () => this.channelPeekState.set({ kind: "error" }),
    });
  }

  viewPayload(kind: "request" | "response", eventId: string): void {
    const correlationId = this.run().correlation_id;
    this.payloadLabelSig.set(kind === "request" ? "Request" : "Response");
    this.payload.set({ kind: "loading" });
    this.trackingChainService
      .getEventPayload(correlationId, eventId)
      .subscribe({
        next: (response) => this.payload.set({ kind: "loaded", response }),
        error: (err: HttpErrorResponse) => {
          if (err.status === 410) {
            this.payload.set({ kind: "expired" });
            return;
          }
          if (err.status === 404) {
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

  onTab(rawEvent: Event): void {
    const event = rawEvent as KeyboardEvent;
    const panelEl = this.panel()?.nativeElement;
    if (!panelEl) {
      return;
    }
    const focusable = panelEl.querySelectorAll<HTMLElement>(
      'button, a[href], [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
