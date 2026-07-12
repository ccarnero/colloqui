import { Location } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from "@angular/core";
import { BreadcrumbsComponent } from "../../../shared/components/breadcrumbs/breadcrumbs.component";
import { RunViewComponent } from "./run-view.component";

/**
 * Route host for `processes/runs/:workflowId/:runId` (T06 of
 * `manual-loops/run-view.md`, entry (a): Workflows → detail → Executions →
 * run row click). `provideCoreApp` enables `withComponentInputBinding()`
 * (packages/angular-shared/src/app-providers.ts), so the route params bind
 * straight onto this component's `workflowId`/`runId` inputs — same
 * mechanism `RunViewComponent` itself relies on when used bare.
 *
 * A thin wrapper (rather than routing directly to `RunViewComponent`) is
 * needed because the URL only carries the TEMPORAL workflow id + run id —
 * the workflow DEFINITION id isn't in the path — so breadcrumbs/back can't
 * build a `/workflows/:definitionId/...` link from route params alone.
 * "Back" therefore uses `Location.back()` (same effect as the browser back
 * button, always returns to wherever the run was opened from — the
 * Executions list today, potentially other entries later) instead of a
 * hardcoded route, consistent with how `WorkflowRunDetailComponent`'s own
 * "Back" only works because ITS route nests under a known `:id`.
 *
 * `definitionId` is an OPTIONAL `?definitionId=` query param (T06 finding
 * fix, `manual-loops/run-view.md`): the Executions entry KNOWS the
 * definition id (executions are always listed scoped to one) and appends
 * it, so `RunViewComponent` can resolve the header's workflow name without
 * mis-using the Temporal `workflowId` against `WorkflowApiService.get`
 * (which needs the definition id, not the Temporal id — see that
 * component's `definitionId` input doc). `withComponentInputBinding()`
 * (packages/angular-shared/src/app-providers.ts) binds route/query params
 * onto matching-named inputs alike, so no extra wiring is needed here.
 */
@Component({
  selector: "app-run-view-page",
  imports: [BreadcrumbsComponent, RunViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rvp">
      <app-breadcrumbs [crumbs]="crumbs" />
      <header class="rvp-head">
        <h1 class="rvp-title">Run view</h1>
        <button class="rvp-back" type="button" (click)="back()">← Back</button>
      </header>
      <app-run-view
        [workflowId]="workflowId()"
        [runId]="runId()"
        [definitionId]="definitionId()"
      />
    </div>
  `,
  styles: `
    :host { display: block; padding: 16px; }
    .rvp { display: flex; flex-direction: column; gap: 12px; }
    .rvp-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .rvp-title { font-size: 18px; font-weight: 500; margin: 0; }
    .rvp-back {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle, #ddd);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface, #fff);
      color: var(--text-primary);
      cursor: pointer;
    }
    .rvp-back:hover { background: var(--bg3); }
  `,
})
export class RunViewPageComponent {
  private readonly location = inject(Location);

  readonly workflowId = input.required<string>();
  readonly runId = input.required<string>();
  readonly definitionId = input<string | undefined>(undefined);

  readonly crumbs = [
    { label: "Processes", route: "/processes" },
    { label: "Workflows", route: "/workflows" },
    { label: "Run view" },
  ];

  back(): void {
    this.location.back();
  }
}
