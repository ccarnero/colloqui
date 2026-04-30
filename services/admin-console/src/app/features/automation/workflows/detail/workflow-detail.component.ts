import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import {
  ActivatedRoute,
  Router,
  RouterOutlet,
} from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { BreadcrumbsComponent } from "../../../../shared/components/breadcrumbs/breadcrumbs.component";
import {
  SubTabsComponent,
  type ISubTab,
} from "../../../../shared/components/sub-tabs/sub-tabs.component";
import {
  WorkflowApiService,
  type IWorkflowDefinitionDto,
} from "../services/workflow-api.service";

/**
 * Shell for `/workflows/:id` — the workflow mini-app. Renders:
 *   - breadcrumbs (Workflows / <name>)
 *   - title row (name + status pill + run/pause/edit actions)
 *   - sub-tabs row (Overview / Builder / Executions / Settings)
 *   - <router-outlet/> for the active sub-tab
 *
 * The Builder tab declares `subNavCollapsed: true` in its route data,
 * which the shell-level sub-nav reads to collapse to icon-mode.
 */
@Component({
  selector: "app-workflow-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, BreadcrumbsComponent, SubTabsComponent],
  template: `
    <div class="detail">
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

  protected runNow(): void {
    const id = this.id();
    if (!id) return;
    this.api.execute(id).subscribe({
      next: () => {
        // After kicking off, route into Executions so the user sees it.
        void this.router.navigate(["/workflows", id, "executions"]);
      },
      error: () => {
        /* swallow — could surface a snack later */
      },
    });
  }

  protected pause(): void {
    /* PHASE 3 TODO: wire pause action when API supports it. */
  }

  protected goBuilder(): void {
    const id = this.id();
    if (id) void this.router.navigate(["/workflows", id, "builder"]);
  }
}
