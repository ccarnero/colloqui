import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from "@angular/router";
import { filter } from "rxjs/operators";
import { type IAgent } from "../../../../core/models/agent.model";
import { AgentAdminService } from "../../../../core/services/agent-admin.service";
import {
  BreadcrumbsComponent,
  type IBreadcrumb,
} from "../../../../shared/components/breadcrumbs/breadcrumbs.component";
import {
  type ISubTab,
  SubTabsComponent,
} from "../../../../shared/components/sub-tabs/sub-tabs.component";
import { AgentEditorBridgeService } from "../agent-editor-bridge.service";
import { PlaygroundComponent } from "../playground.component";

@Component({
  selector: "app-ai-agent-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AgentEditorBridgeService],
  imports: [
    RouterOutlet,
    BreadcrumbsComponent,
    SubTabsComponent,
    PlaygroundComponent,
    MatIconModule,
    MatButtonModule,
  ],
  template: `
    <div class="detail" [class.chrome-suppressed]="isConfigureActive()">
      @if (!isConfigureActive()) {
        <app-breadcrumbs [crumbs]="crumbs()" />

        <header class="detail-h">
          <div class="detail-title-wrap">
            <h1 class="detail-title">{{ agent()?.name ?? id() }}</h1>
            @if (agent(); as current) {
              <span class="status-pill" [class]="'status-' + current.status">
                <span class="dot" aria-hidden="true"></span>
                {{ current.status }}
              </span>
            }
            @if (bridge.editingAgentId() && bridge.isDirty()) {
              <span class="dirty-pill" title="You have unsaved local changes">
                <span class="dirty-dot" aria-hidden="true"></span>
                Unsaved changes
              </span>
            }
          </div>

          <div class="detail-actions">
            <button class="btn btn-secondary btn-sm" type="button" (click)="toggleTestPanel()">
              {{ testPanelOpen() ? "Hide test panel" : "Test agent" }}
            </button>
            <button class="btn btn-secondary btn-sm" type="button" (click)="openPlayground()">
              Open playground
            </button>

            @if (bridge.editingAgentId()) {
              <span class="action-divider" aria-hidden="true"></span>
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                [disabled]="bridge.saving()"
                (click)="bridge.requestCancel()"
              >
                Cancel
              </button>
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                [disabled]="bridge.saving()"
                (click)="bridge.requestReset()"
              >
                Reset
              </button>
              <button
                class="btn btn-primary btn-sm"
                type="button"
                [disabled]="
                  bridge.saving() || bridge.loading() || !bridge.canSave()
                "
                (click)="bridge.requestSave()"
              >
                {{ bridge.saving() ? "Saving..." : "Save" }}
              </button>
            } @else {
              <button class="btn btn-primary btn-sm" type="button" (click)="goConfigure()">
                Configure
              </button>
            }
          </div>
        </header>

        <app-sub-tabs [tabs]="tabs" />
      }

      <!--
        Floating chrome (Task B - agent chrome parity): structurally and
        visually mirrors WorkflowBuilderComponent's floating chrome
        (features/automation/workflows/builder/workflow-builder.component.ts
        - the .floating-chrome/.chrome-pill/.chrome-segmented markup and
        classes below are copied from there) so the agent configure screen
        reads as the same design language as the workflow builder.
        MIRRORED rather than extracted into a shared component: the
        workflow chrome also owns a canvas/zoom/node-count concept this
        screen has no equivalent for, and the action set differs
        (Save/Publish-Unpublish vs Save/Run/Pause) enough that forcing a
        shared component would need a slot-heavy abstraction for a single
        second consumer. Shown only on /configure, replacing the
        conventional header above the same way the workflow builder's
        floating chrome replaces workflow-detail's header only on /builder
        (see workflow-detail.component.ts's isBuilderActive/full-bleed
        pattern).
      -->
      @if (isConfigureActive()) {
        <div class="floating-chrome floating-top" data-testid="agent-chrome">
          <div class="chrome-pill chrome-identity">
            <button
              class="chrome-icon-btn"
              type="button"
              (click)="goBackToAgents()"
              aria-label="Back to agents"
            >
              <mat-icon>arrow_back</mat-icon>
            </button>
            <span class="chrome-breadcrumb">ai / agents /</span>
            <span class="chrome-agent-name">{{ agent()?.name ?? id() }}</span>
          </div>

          <div
            class="chrome-pill chrome-save-state"
            [class.is-saving]="bridge.saving()"
            data-testid="agent-chrome-save-state"
          >
            <mat-icon>{{ bridge.saving() ? "sync" : "check_circle" }}</mat-icon>
            {{ saveStateLabel() }}
          </div>

          <div
            class="chrome-pill chrome-segmented"
            role="tablist"
            data-testid="agent-chrome-segmented-control"
          >
            <button
              type="button"
              class="segment"
              role="tab"
              aria-selected="false"
              (click)="goToAgentTab('overview')"
            >
              Overview
            </button>
            <button
              type="button"
              class="segment active"
              role="tab"
              aria-selected="true"
              disabled
            >
              Configure
            </button>
            <button
              type="button"
              class="segment"
              role="tab"
              aria-selected="false"
              (click)="goToAgentTab('settings')"
            >
              Settings
            </button>
          </div>

          <span class="chrome-spacer"></span>

          @if (agent(); as current) {
            <span
              class="chrome-pill chrome-status-pill status-pill"
              [class]="'status-' + current.status"
            >
              <span class="dot" aria-hidden="true"></span>
              {{ current.status }}
            </span>
          }

          <div class="chrome-pill chrome-actions">
            <button mat-flat-button type="button" (click)="openPlayground()">
              <mat-icon>open_in_new</mat-icon>
              Playground
            </button>
            <button
              mat-flat-button
              type="button"
              (click)="toggleTestPanel()"
              [class.active]="testPanelOpen()"
            >
              <mat-icon>play_arrow</mat-icon>
              {{ testPanelOpen() ? "Hide test" : "Test agent" }}
            </button>
            @if (bridge.editingAgentId()) {
              <button
                mat-flat-button
                type="button"
                [disabled]="bridge.saving()"
                (click)="bridge.requestCancel()"
              >
                Cancel
              </button>
              <button
                mat-flat-button
                type="button"
                [disabled]="bridge.saving()"
                (click)="bridge.requestReset()"
              >
                Reset
              </button>
            }
            @if (agent()?.status === "draft") {
              <button
                mat-flat-button
                type="button"
                [disabled]="publishing()"
                (click)="publishAgent()"
              >
                <mat-icon>publish</mat-icon>
                Publish
              </button>
            }
            @if (agent()?.status === "published") {
              <button
                mat-flat-button
                type="button"
                [disabled]="publishing()"
                (click)="unpublishAgent()"
              >
                <mat-icon>unpublished</mat-icon>
                Unpublish
              </button>
            }
            <button
              mat-flat-button
              type="button"
              [disabled]="
                bridge.saving() || bridge.loading() || !bridge.canSave()
              "
              (click)="bridge.requestSave()"
            >
              <mat-icon>save</mat-icon>
              {{ bridge.saving() ? "Saving..." : "Save" }}
            </button>
          </div>
        </div>
      }

      <div class="detail-body" [class.test-open]="testPanelOpen()">
        <section class="detail-content">
          <router-outlet />
        </section>

        @if (testPanelOpen()) {
          <aside class="test-drawer">
            <header class="test-drawer-h">
              <h2>Quick Test</h2>
              <button class="btn btn-secondary btn-sm" type="button" (click)="toggleTestPanel()">
                Close
              </button>
            </header>

            <app-playground
              [presetAgentId]="id()"
              [lockAgentSelection]="true"
              [embedded]="true"
            />
          </aside>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .detail {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
    }

    /* No extra gap needed above the floating chrome once the conventional
       header is suppressed (mirrors workflow-detail's .full-bleed gap: 0). */
    .detail.chrome-suppressed {
      gap: 0;
    }

    .detail-h {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .detail-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .detail-title {
      margin: 0;
      font-size: 20px;
      color: var(--text-primary);
      font-weight: 600;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      text-transform: capitalize;
      font-size: 12px;
      font-weight: 600;
    }

    .status-draft {
      color: var(--yellow, #fdbd27);
      background: rgba(253, 189, 39, 0.15);
    }

    .status-published {
      color: var(--green, #22c55e);
      background: rgba(34, 197, 94, 0.15);
    }

    .status-archived {
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.08);
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.9;
    }

    .detail-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .action-divider {
      width: 1px;
      height: 22px;
      background: var(--border-subtle);
      margin: 0 2px;
    }

    .dirty-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(253, 189, 39, 0.12);
      color: #fdbd27;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border: 1px solid rgba(253, 189, 39, 0.3);
    }

    .dirty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #fdbd27;
    }

    /*
     * Floating chrome (Task B) - copied verbatim from
     * workflow-builder.component.ts's .floating-chrome/.chrome-pill styles
     * (same tokens, same pill/segmented-control visual language). This
     * screen scrolls as a normal document (no canvas), so "position: sticky"
     * replaces the workflow builder's "position: absolute" over its
     * fixed-height canvas - the practical effect (chrome always visible)
     * is the same, adapted to a scrolling context.
     */
    .floating-chrome {
      position: sticky;
      top: var(--rd-space-3, 12px);
      z-index: 5;
      display: flex;
      align-items: center;
      gap: var(--rd-space-4, 8px);
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .chrome-pill {
      display: flex;
      align-items: center;
      gap: var(--rd-space-4, 8px);
      background: var(--rd-panel, var(--bg-surface));
      border: 1px solid var(--rd-line-3, var(--border-subtle));
      border-radius: var(--rd-radius-7, 10px);
      padding: var(--rd-space-3, 6px) var(--rd-space-6, 12px);
      box-shadow: var(--rd-shadow-md, 0 1px 3px rgba(0, 0, 0, 0.2));
    }

    .chrome-identity {
      padding: var(--rd-space-2, 4px) var(--rd-space-4, 8px);
      min-width: 0;
    }

    .chrome-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: var(--rd-radius-5, 6px);
      background: transparent;
      color: var(--text2);
      cursor: pointer;
      flex-shrink: 0;
    }

    .chrome-icon-btn:hover {
      background: var(--bg3);
      color: var(--text-primary);
    }

    .chrome-icon-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .chrome-breadcrumb {
      font-family: var(--rd-font-mono, monospace);
      font-size: 11px;
      color: var(--text3);
      white-space: nowrap;
    }

    .chrome-agent-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 260px;
    }

    .chrome-save-state {
      font-family: var(--rd-font-mono, monospace);
      font-size: 11px;
      color: var(--green, #22c55e);
      gap: var(--rd-space-2, 4px);
    }

    .chrome-save-state mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--green, #22c55e);
    }

    .chrome-save-state.is-saving,
    .chrome-save-state.is-saving mat-icon {
      color: var(--text3);
    }

    .chrome-segmented {
      padding: 2px;
      gap: 2px;
    }

    .segment {
      border: none;
      background: transparent;
      color: var(--text2);
      font-size: 11px;
      font-family: inherit;
      padding: var(--rd-space-2, 4px) var(--rd-space-5, 10px);
      border-radius: var(--rd-radius-5, 6px);
      cursor: pointer;
    }

    .segment:hover:not(:disabled) {
      background: var(--bg3);
      color: var(--text-primary);
    }

    .segment.active {
      background: var(--primary, #1a66ff);
      color: #fff;
      cursor: default;
    }

    .chrome-spacer {
      flex: 1;
    }

    .chrome-status-pill {
      /* Additive vs the workflow chrome (which has no agent-status concept):
         reuses this component's own existing .status-pill/.status-* classes
         (defined above) rather than inventing new colors. */
      padding: 4px 10px;
    }

    .chrome-actions {
      gap: var(--rd-space-3, 6px);
    }

    button.active {
      background: var(--primary, #1a66ff);
      color: #fff;
    }

    .detail-body {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      min-height: 560px;
    }

    .detail-body.test-open {
      grid-template-columns: minmax(0, 1fr) minmax(420px, 460px);
    }

    .detail-content {
      min-width: 0;
      min-height: 0;
    }

    .test-drawer {
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      background: var(--bg-surface);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      /*
       * Pin the drawer to the viewport so chat doesn't push the page down.
       * Use a definite height (not max-height) so descendants with
       * height: 100% can resolve and the messages-area's flex:1 + overflow-y
       * auto actually engage. align-self: start keeps the grid row from
       * stretching the drawer to match the editor's height.
       */
      position: sticky;
      top: 12px;
      align-self: start;
      height: calc(100dvh - 180px);
    }

    .test-drawer-h {
      flex-shrink: 0;
    }

    .test-drawer app-playground {
      flex: 1 1 auto;
      display: block;
      min-height: 0;
      overflow: hidden;
    }

    .test-drawer-h {
      padding: 12px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .test-drawer-h h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    @media (max-width: 1380px) {
      .detail-body.test-open {
        grid-template-columns: 1fr;
      }

      .test-drawer {
        min-height: 480px;
      }
    }
  `,
})
export class AiAgentDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly agentAdminService = inject(AgentAdminService);
  // Public (not protected): the floating-chrome spec pokes bridge.saving()/
  // isDirty() directly, mirroring how WorkflowBuilderComponent exposes its
  // own chrome-driving signals (`saving`, `flow`) publicly for its sibling
  // chrome spec (workflow-builder-chrome.spec.ts).
  readonly bridge = inject(AgentEditorBridgeService);

  private readonly params = toSignal(this.route.params, {
    initialValue: this.route.snapshot.params,
  });

  protected readonly id = computed(() => String(this.params()["id"] ?? ""));
  protected readonly agent = signal<IAgent | null>(null);
  readonly testPanelOpen = signal(false);
  protected readonly publishing = signal(false);

  protected readonly tabs: ISubTab[] = [
    { label: "Overview", route: "overview" },
    { label: "Configure", route: "configure" },
    { label: "Settings", route: "settings" },
  ];

  protected readonly crumbs = computed<IBreadcrumb[]>(() => {
    return [
      { label: "AI", route: "/ai" },
      { label: "Agents", route: "/ai/agents" },
      { label: this.agent()?.name ?? this.id() },
    ];
  });

  /**
   * Reactive on every navigation (see the router.events subscription below,
   * which touches this signal). Drives the floating-chrome swap the same
   * way workflow-detail.component.ts's `isBuilderActive` does for the
   * builder route.
   */
  private readonly navTick = signal(0);

  readonly isConfigureActive = computed<boolean>(() => {
    this.navTick();
    return this.isOnConfigureRoute();
  });

  /**
   * Floating-chrome save-state label (Task B). Reuses only state the bridge
   * already tracks from the inner editor (saving/isDirty, pushed by
   * ai.component.ts) - no new dirty-diffing introduced, mirroring how
   * WorkflowBuilderComponent.saveStateLabel only reuses its own existing
   * `saving`/`flow().key` signals. Unlike the workflow's brand-new-vs-saved
   * distinction, an agent reached via /configure always already exists
   * (has a persisted id), so the only two real states here are "saving" and
   * "dirty vs not" - "Unsaved" here means uncommitted local edits, not "never
   * created".
   */
  readonly saveStateLabel = computed<string>(() => {
    if (this.bridge.saving()) {
      return "Saving…";
    }
    return this.bridge.isDirty() ? "Unsaved" : "Saved";
  });

  constructor() {
    effect(() => {
      const agentId = this.id();
      if (!agentId) {
        this.agent.set(null);
        return;
      }

      // Auto-open the test drawer on /configure for live agent testing.
      this.testPanelOpen.set(this.isOnConfigureRoute());
      this.loadAgent(agentId);
    });

    effect(() => {
      const saved = this.bridge.savedAgent();
      if (!saved) {
        return;
      }
      if (saved.id !== this.id()) {
        return;
      }

      this.agent.update((current) =>
        current ? { ...current, name: saved.name } : current
      );
    });

    effect(() => {
      const deletedId = this.bridge.deletedAgentId();
      if (!deletedId) {
        return;
      }
      if (deletedId !== this.id()) {
        return;
      }
      void this.router.navigate(["/ai/agents"]);
    });

    // Re-open the test drawer when the user navigates into /configure
    // from a sibling tab. Keeps the manual close behavior intact otherwise.
    // Also ticks navTick so isConfigureActive() recomputes on every
    // navigation (mirrors workflow-detail.component.ts's navEnd signal).
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.navTick.update((n) => n + 1);
        if (this.isOnConfigureRoute() && !this.testPanelOpen()) {
          this.testPanelOpen.set(true);
        }
      });
  }

  private isOnConfigureRoute(): boolean {
    return this.router.url.includes("/configure");
  }

  toggleTestPanel(): void {
    this.testPanelOpen.set(!this.testPanelOpen());
  }

  openPlayground(): void {
    void this.router.navigate(["/ai/playground"], {
      queryParams: { agentId: this.id() },
    });
  }

  protected goConfigure(): void {
    void this.router.navigate(["/ai/agents", this.id(), "configure"]);
  }

  protected goBackToAgents(): void {
    void this.router.navigate(["/ai/agents"]);
  }

  /**
   * Segmented-control navigation (Task B) - mirrors
   * WorkflowBuilderComponent.goToTab: routes to the sibling sub-route,
   * "Configure" has no target since it's this route (the disabled active
   * segment).
   */
  protected goToAgentTab(tab: "overview" | "settings"): void {
    void this.router.navigate(["/ai/agents", this.id(), tab]);
  }

  /**
   * Publish/unpublish (Task B) - same API calls as
   * ai-agent-settings.component.ts's publish()/unpublish() (AgentAdminService
   * publishAgent/unpublishAgent), just triggered from the floating chrome
   * instead. Updates the local `agent` signal so the chrome's status pill
   * and Publish/Unpublish button swap immediately.
   */
  publishAgent(): void {
    const agentId = this.id();
    if (!agentId) {
      return;
    }
    this.publishing.set(true);
    this.agentAdminService.publishAgent(agentId).subscribe({
      next: (updated) => {
        this.agent.set(updated);
        this.publishing.set(false);
      },
      error: () => {
        this.publishing.set(false);
      },
    });
  }

  protected unpublishAgent(): void {
    const agentId = this.id();
    if (!agentId) {
      return;
    }
    this.publishing.set(true);
    this.agentAdminService.unpublishAgent(agentId).subscribe({
      next: (updated) => {
        this.agent.set(updated);
        this.publishing.set(false);
      },
      error: () => {
        this.publishing.set(false);
      },
    });
  }

  private loadAgent(agentId: string): void {
    this.agentAdminService.getAgent(agentId).subscribe({
      next: (agent) => {
        this.agent.set(agent);
      },
      error: () => {
        this.agent.set(null);
      },
    });
  }
}
