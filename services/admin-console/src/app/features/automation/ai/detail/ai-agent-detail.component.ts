import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter } from "rxjs/operators";
import {
  BreadcrumbsComponent,
  type IBreadcrumb,
} from "../../../../shared/components/breadcrumbs/breadcrumbs.component";
import {
  SubTabsComponent,
  type ISubTab,
} from "../../../../shared/components/sub-tabs/sub-tabs.component";
import {
  type IAgent,
} from "../../../../core/models/agent.model";
import { AgentAdminService } from "../../../../core/services/agent-admin.service";
import { PlaygroundComponent } from "../playground.component";
import { AgentEditorBridgeService } from "../agent-editor-bridge.service";

@Component({
  selector: "app-ai-agent-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AgentEditorBridgeService],
  imports: [RouterOutlet, BreadcrumbsComponent, SubTabsComponent, PlaygroundComponent],
  template: `
    <div class="detail">
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
  protected readonly bridge = inject(AgentEditorBridgeService);

  private readonly params = toSignal(this.route.params, {
    initialValue: this.route.snapshot.params,
  });

  protected readonly id = computed(() => String(this.params()["id"] ?? ""));
  protected readonly agent = signal<IAgent | null>(null);
  protected readonly testPanelOpen = signal(false);

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
      if (!saved) return;
      if (saved.id !== this.id()) return;

      this.agent.update((current) =>
        current ? { ...current, name: saved.name } : current,
      );
    });

    effect(() => {
      const deletedId = this.bridge.deletedAgentId();
      if (!deletedId) return;
      if (deletedId !== this.id()) return;
      void this.router.navigate(["/ai/agents"]);
    });

    // Re-open the test drawer when the user navigates into /configure
    // from a sibling tab. Keeps the manual close behavior intact otherwise.
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        if (this.isOnConfigureRoute() && !this.testPanelOpen()) {
          this.testPanelOpen.set(true);
        }
      });
  }

  private isOnConfigureRoute(): boolean {
    return this.router.url.includes("/configure");
  }

  protected toggleTestPanel(): void {
    this.testPanelOpen.set(!this.testPanelOpen());
  }

  protected openPlayground(): void {
    void this.router.navigate(["/ai/playground"], {
      queryParams: { agentId: this.id() },
    });
  }

  protected goConfigure(): void {
    void this.router.navigate(["/ai/agents", this.id(), "configure"]);
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
