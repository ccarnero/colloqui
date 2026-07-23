import "@angular/compiler";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type IWorkflowDefinitionDto,
  WorkflowApiService,
} from "../services/workflow-api.service";
import { WorkflowDetailComponent } from "./workflow-detail.component";
import { WorkflowRunActionsService } from "./workflow-run-actions.service";

@Component({ selector: "app-test-child", template: "child" })
class BlankChildComponent {}

const WORKFLOW: IWorkflowDefinitionDto = {
  id: "wf-1",
  name: "http-fanout-telegram",
  application: "default",
  tenantId: "acme",
  actions: [],
  trigger: { type: "channel" },
  createdAt: "2026-07-01T00:00:00.000Z",
};

const ROUTES = [
  {
    path: "workflows/:id",
    component: WorkflowDetailComponent,
    children: [
      { path: "overview", component: BlankChildComponent },
      {
        path: "builder",
        component: BlankChildComponent,
        data: { subNavHidden: true },
      },
      { path: "executions", component: BlankChildComponent },
      { path: "settings", component: BlankChildComponent },
    ],
  },
];

/**
 * T02 (SPEC decision 2) — the wrapper chrome (breadcrumb, title row,
 * sub-tabs row) must be suppressed only while the active nested child
 * route is `builder`; it must stay visible on overview/executions/settings
 * so those tabs keep their existing Run now/Pause/Edit affordances. Uses
 * `RouterTestingHarness` so `WorkflowDetailComponent` is mounted through a
 * real `<router-outlet>` — required for its own `ActivatedRoute` (and
 * `:id` param) to resolve correctly, same as production.
 */
describe("WorkflowDetailComponent — builder full-bleed chrome suppression (T02)", () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(ROUTES),
        {
          provide: WorkflowApiService,
          useValue: { get: vi.fn().mockReturnValue(of(WORKFLOW)) },
        },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  it("renders the wrapper chrome on the overview child route", async () => {
    await harness.navigateByUrl("/workflows/wf-1/overview");
    harness.detectChanges();

    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector("app-breadcrumbs")).toBeTruthy();
    expect(el.querySelector(".detail-h")).toBeTruthy();
    expect(el.querySelector("app-sub-tabs")).toBeTruthy();
  });

  it("suppresses the wrapper chrome on the builder child route", async () => {
    await harness.navigateByUrl("/workflows/wf-1/builder");
    harness.detectChanges();

    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector("app-breadcrumbs")).toBeFalsy();
    expect(el.querySelector(".detail-h")).toBeFalsy();
    expect(el.querySelector("app-sub-tabs")).toBeFalsy();
    // The router-outlet itself must still render the builder child.
    expect(el.textContent).toContain("child");
  });

  it("renders the wrapper chrome on the executions child route", async () => {
    await harness.navigateByUrl("/workflows/wf-1/executions");
    harness.detectChanges();

    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector(".detail-h")).toBeTruthy();
  });

  it("renders the wrapper chrome on the settings child route", async () => {
    await harness.navigateByUrl("/workflows/wf-1/settings");
    harness.detectChanges();

    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector(".detail-h")).toBeTruthy();
  });

  it("restores the wrapper chrome after navigating away from builder", async () => {
    await harness.navigateByUrl("/workflows/wf-1/builder");
    harness.detectChanges();
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector(".detail-h")
    ).toBeFalsy();

    await harness.navigateByUrl("/workflows/wf-1/overview");
    harness.detectChanges();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector(".detail-h")
    ).toBeTruthy();
  });
});

/**
 * T02 — Run now / Pause on the wrapper header must delegate to
 * `WorkflowRunActionsService`, the exact same wiring the builder's
 * floating chrome now uses too.
 */
describe("WorkflowDetailComponent — Run now / Pause wiring (T02)", () => {
  let harness: RouterTestingHarness;
  let runNow: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    runNow = vi.fn();
    pause = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        provideRouter(ROUTES),
        {
          provide: WorkflowApiService,
          useValue: { get: vi.fn().mockReturnValue(of(WORKFLOW)) },
        },
        { provide: WorkflowRunActionsService, useValue: { runNow, pause } },
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl("/workflows/wf-1/overview");
    harness.detectChanges();
  });

  it("delegates 'Run now' to WorkflowRunActionsService.runNow with the route id", () => {
    const el = harness.routeNativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>(".btn"));
    const runNowBtn = buttons.find((b) => b.textContent?.trim() === "Run now");
    runNowBtn!.click();

    expect(runNow).toHaveBeenCalledWith("wf-1");
  });

  it("delegates 'Pause' to WorkflowRunActionsService.pause with the route id", () => {
    const el = harness.routeNativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>(".btn"));
    const pauseBtn = buttons.find((b) => b.textContent?.trim() === "Pause");
    pauseBtn!.click();

    expect(pause).toHaveBeenCalledWith("wf-1");
  });
});
