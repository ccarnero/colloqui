import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from "@angular/router";
import { filter } from "rxjs/operators";
import { BreadcrumbsComponent } from "../../../../shared/components/breadcrumbs/breadcrumbs.component";
import {
  type ISubTab,
  SubTabsComponent,
} from "../../../../shared/components/sub-tabs/sub-tabs.component";
import {
  type IWorkflowDefinitionDto,
  WorkflowApiService,
} from "../services/workflow-api.service";
import { WorkflowRunActionsService } from "./workflow-run-actions.service";

/**
 * Walks the active child route chain from `route` and returns the deepest
 * child's route-config `path` segment (e.g. "builder", "executions").
 * Mirrors `shell.component.ts`'s `readRouteDataFlag` walk pattern for
 * detecting the currently active nested route (T02).
 */
function activeChildPath(route: ActivatedRoute): string | null {
  let r: ActivatedRoute | null = route.firstChild;
  let path: string | null = null;
  while (r) {
    if (r.snapshot.routeConfig?.path) {
      path = r.snapshot.routeConfig.path;
    }
    r = r.firstChild;
  }
  return path;
}

/**
 * Shell for `/workflows/:id` — the workflow mini-app. Renders:
 *   - breadcrumbs (Workflows / <name>)
 *   - title row (name + status pill + run/pause/edit actions)
 *   - sub-tabs row (Overview / Builder / Executions / Settings)
 *   - <router-outlet/> for the active sub-tab
 *
 * T02 (SPEC decision 2): when the active child route is `builder`, this
 * wrapper chrome (breadcrumb, title row, sub-tabs row) is suppressed so the
 * builder canvas renders edge-to-edge — the builder's own floating chrome
 * carries the equivalent navigation (segmented control) and actions
 * (Run now / Pause) instead. The route itself still sets
 * `subNavHidden: true` (app.routes.ts) so the shell-level sub-nav rail also
 * hides; that flag is unrelated to this component's own chrome, which is
 * suppressed here via `isBuilderActive`.
 */
@Component({
  selector: "app-workflow-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, BreadcrumbsComponent, SubTabsComponent],
  template: `
    <div class="detail">
      @if (!isBuilderActive()) {
        <app-breadcrumbs [crumbs]="crumbs()" />

        <header class="detail-h">
          <div class="detail-title-block">
            <h1 class="detail-title">
              {{ workflow()?.name ?? id() }}
              @if (workflow(); as wf) {
                <span class="status-pill" [class]="'status-' + statusOf(wf)">
                  <span class="dot" aria-hidden="true"></span>
                  {{ statusLabel(wf) }}
                </span>
              }
            </h1>
          </div>
          <div class="detail-actions">
            <button class="btn" type="button" (click)="runNow()">Run now</button>
            <button class="btn" type="button" (click)="pause()">Pause</button>
            <button class="btn btn-primary" type="button" (click)="goBuilder()">
              Edit
            </button>
          </div>
        </header>

        <app-sub-tabs [tabs]="tabs()" />
      }

      <router-outlet />
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
    }
    .detail-h {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .detail-title-block {
      min-width: 0;
    }
    .detail-title {
      font-size: 20px;
      font-weight: 500;
      margin: 0;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .status-pill {
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 500;
    }
    .status-active {
      background: color-mix(in srgb, var(--green, #16a34a) 15%, transparent);
      color: var(--green, #16a34a);
    }
    .status-draft {
      background: var(--bg3);
      color: var(--text2);
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: currentColor;
      opacity: 0.85;
    }
    .detail-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn:hover { background: var(--bg3); }
    .btn-primary {
      background: var(--primary, #1a66ff);
      color: #fff;
      border-color: var(--primary, #1a66ff);
    }
    .btn-primary:hover { opacity: 0.9; }
  `,
})
export class WorkflowDetailComponent implements OnInit {
  private readonly api = inject(WorkflowApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runActions = inject(WorkflowRunActionsService);

  /** Reactive id from the route param (`:id`). */
  private readonly params = toSignal(this.route.params, {
    initialValue: this.route.snapshot.params,
  });
  readonly id = computed<string>(() => this.params()["id"] ?? "");

  readonly workflow = signal<IWorkflowDefinitionDto | null>(null);

  readonly tabs = computed<ISubTab[]>(() => {
    const id = this.id();
    return [
      { label: "Overview", route: `/workflows/${id}/overview` },
      { label: "Builder", route: `/workflows/${id}/builder` },
      { label: "Executions", route: `/workflows/${id}/executions` },
      { label: "Settings", route: `/workflows/${id}/settings` },
    ];
  });

  readonly crumbs = computed(() => [
    { label: "Workflows", route: "/workflows" },
    { label: this.workflow()?.name ?? this.id() },
  ]);

  /** Recomputes on every NavigationEnd so `isBuilderActive` stays fresh. */
  private readonly navEnd = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)),
    { initialValue: null }
  );

  /**
   * T02: true while the active nested child route is `builder`. Drives
   * suppression of the wrapper chrome (breadcrumb, title row, sub-tabs) so
   * the builder canvas can render edge-to-edge; the builder's own floating
   * chrome carries the equivalent navigation and actions instead.
   */
  readonly isBuilderActive = computed<boolean>(() => {
    // Touch navEnd so this recomputes on every navigation.
    this.navEnd();
    const path = activeChildPath(this.route);
    const isBuilder = path === "builder";
    console.debug("[WorkflowDetailComponent] active child route recomputed", {
      path,
      isBuilder,
    });
    return isBuilder;
  });

  ngOnInit(): void {
    const id = this.id();
    if (id) {
      this.api.get(id).subscribe({
        next: (wf) => this.workflow.set(wf),
        // Failures here are non-fatal for the shell — the sub-tab will
        // surface its own errors as needed.
        error: () => this.workflow.set(null),
      });
    }
  }

  protected statusOf(wf: IWorkflowDefinitionDto): "active" | "draft" {
    return wf.trigger ? "active" : "draft";
  }

  protected statusLabel(wf: IWorkflowDefinitionDto): string {
    return wf.trigger ? "Active" : "Draft";
  }

  /**
   * Delegates to `WorkflowRunActionsService` (T02) so this wrapper header
   * and the builder's floating chrome fire the EXACT same dialog + API
   * call — no wiring duplicated between the two surfaces.
   */
  protected runNow(): void {
    const id = this.id();
    if (!id) {
      return;
    }
    this.runActions.runNow(id);
  }

  protected pause(): void {
    const id = this.id();
    if (!id) {
      return;
    }
    this.runActions.pause(id);
  }

  protected goBuilder(): void {
    const id = this.id();
    if (id) {
      void this.router.navigate(["/workflows", id, "builder"]);
    }
  }
}
