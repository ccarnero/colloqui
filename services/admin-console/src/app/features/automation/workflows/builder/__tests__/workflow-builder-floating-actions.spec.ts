import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowRunActionsService } from "../../detail/workflow-run-actions.service";
import {
  type IWorkflowDefinitionDto,
  WorkflowApiService,
} from "../../services/workflow-api.service";
import { WorkflowBuilderComponent } from "../workflow-builder.component";

const WORKFLOW_DTO: IWorkflowDefinitionDto = {
  id: "wf-1",
  name: "http-fanout-telegram",
  application: "default",
  tenantId: "acme",
  actions: [],
  trigger: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

/**
 * T02 — the floating chrome now carries the segmented control (Editor /
 * Runs / Settings, replacing the detail wrapper's sub-tabs row for this
 * route) plus Run now / Pause (relocated from the wrapper header, reusing
 * `WorkflowRunActionsService`'s exact wiring). Both only render once a
 * persisted `:id` is known.
 */
describe("WorkflowBuilderComponent — floating segmented control + Run now/Pause (T02)", () => {
  let fixture: ComponentFixture<WorkflowBuilderComponent>;
  let router: Router;
  let runNow: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;

  async function setup(routeId: string | null) {
    runNow = vi.fn();
    pause = vi.fn();

    await TestBed.configureTestingModule({
      imports: [WorkflowBuilderComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: WorkflowApiService,
          useValue: { get: vi.fn().mockReturnValue(of(WORKFLOW_DTO)) },
        },
        { provide: WorkflowRunActionsService, useValue: { runNow, pause } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: new Map(routeId ? [["id", routeId]] : []) },
            parent: null,
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);

    fixture = TestBed.createComponent(WorkflowBuilderComponent);
    fixture.detectChanges();
  }

  describe("with a persisted workflow id", () => {
    beforeEach(async () => {
      await setup("wf-1");
    });

    it("renders the segmented control with Editor active", () => {
      const el = fixture.nativeElement as HTMLElement;
      const control = el.querySelector(
        '[data-testid="builder-segmented-control"]'
      );
      expect(control).toBeTruthy();
      expect(control?.textContent).toContain("Editor");
      expect(control?.textContent).toContain("Runs");
      expect(control?.textContent).toContain("Settings");
      expect(
        control?.querySelector(".segment.active")?.textContent?.trim()
      ).toBe("Editor");
    });

    it("navigates to the executions route when 'Runs' is clicked", () => {
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(
        el.querySelectorAll<HTMLButtonElement>(
          '[data-testid="builder-segmented-control"] .segment'
        )
      );
      const runsBtn = buttons.find((b) => b.textContent?.trim() === "Runs");
      runsBtn!.click();

      expect(router.navigate).toHaveBeenCalledWith([
        "/workflows",
        "wf-1",
        "executions",
      ]);
    });

    it("navigates to the settings route when 'Settings' is clicked", () => {
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(
        el.querySelectorAll<HTMLButtonElement>(
          '[data-testid="builder-segmented-control"] .segment'
        )
      );
      const settingsBtn = buttons.find(
        (b) => b.textContent?.trim() === "Settings"
      );
      settingsBtn!.click();

      expect(router.navigate).toHaveBeenCalledWith([
        "/workflows",
        "wf-1",
        "settings",
      ]);
    });

    it("delegates 'Run now' to WorkflowRunActionsService with the workflow id", () => {
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".chrome-actions button")
      );
      const runNowBtn = buttons.find((b) => b.textContent?.includes("Run now"));
      expect(runNowBtn).toBeTruthy();
      runNowBtn!.click();

      expect(runNow).toHaveBeenCalledWith("wf-1");
    });

    it("delegates 'Pause' to WorkflowRunActionsService with the workflow id", () => {
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".chrome-actions button")
      );
      const pauseBtn = buttons.find((b) => b.textContent?.includes("Pause"));
      expect(pauseBtn).toBeTruthy();
      pauseBtn!.click();

      expect(pause).toHaveBeenCalledWith("wf-1");
    });

    it("still fires Run Test / Save unaffected by the relocated actions", () => {
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".chrome-actions button")
      );
      expect(buttons.some((b) => b.textContent?.includes("Run Test"))).toBe(
        true
      );
      expect(buttons.some((b) => b.textContent?.includes("Save"))).toBe(true);
    });
  });

  describe("without a persisted workflow id (new workflow)", () => {
    beforeEach(async () => {
      await setup(null);
    });

    it("does not render the segmented control", () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(
        el.querySelector('[data-testid="builder-segmented-control"]')
      ).toBeFalsy();
    });

    it("does not render Run now / Pause", () => {
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".chrome-actions button")
      );
      expect(buttons.some((b) => b.textContent?.includes("Run now"))).toBe(
        false
      );
      expect(buttons.some((b) => b.textContent?.includes("Pause"))).toBe(false);
    });
  });
});
