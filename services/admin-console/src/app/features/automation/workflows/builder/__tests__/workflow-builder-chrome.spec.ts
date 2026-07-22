import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { vi } from "vitest";
import { WorkflowBuilderComponent } from "../workflow-builder.component";

/**
 * T03 — floating chrome (back / workflow name / save state) rendered over
 * the full-bleed canvas. Save state reuses only the `saving` signal + the
 * already-tracked `flow().key` (empty until the first successful save) —
 * see the `saveStateLabel` computed on WorkflowBuilderComponent; no new
 * dirty-tracking state was introduced.
 */
describe("WorkflowBuilderComponent — floating chrome (T03)", () => {
  let fixture: ComponentFixture<WorkflowBuilderComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowBuilderComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map() }, parent: null },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);

    fixture = TestBed.createComponent(WorkflowBuilderComponent);
    fixture.detectChanges();
  });

  it("renders the workflow name in the floating chrome", () => {
    const el = fixture.nativeElement as HTMLElement;
    const nameInput = el.querySelector<HTMLInputElement>(
      ".builder-title-input"
    );
    expect(nameInput).toBeTruthy();
    expect(nameInput!.value).toBe("New Workflow");
  });

  it("renders 'Unsaved' when the workflow has no persisted key yet", () => {
    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector('[data-testid="builder-save-state"]');
    expect(saveState?.textContent).toContain("Unsaved");
  });

  it("renders 'Saved' once the workflow has a persisted key", () => {
    fixture.componentInstance.flow.update((f) => ({ ...f, key: "wf-1" }));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector('[data-testid="builder-save-state"]');
    expect(saveState?.textContent).toContain("Saved");
    expect(saveState?.textContent).not.toContain("Unsaved");
  });

  it("renders 'Saving…' while a save is in flight", () => {
    fixture.componentInstance.saving.set(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector('[data-testid="builder-save-state"]');
    expect(saveState?.textContent).toContain("Saving");
  });

  it("navigates back to /workflows when the back button is clicked", () => {
    const el = fixture.nativeElement as HTMLElement;
    const backButton = el.querySelector<HTMLButtonElement>(
      '[aria-label="Back to workflows"]'
    );
    expect(backButton).toBeTruthy();

    backButton!.click();

    expect(router.navigate).toHaveBeenCalledWith(["/workflows"]);
  });

  it("renders zoom controls wired to the canvas zoom API", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[aria-label="Zoom in"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Zoom out"]')).toBeTruthy();
    expect(el.querySelector(".zoom-readout")?.textContent).toContain("%");
  });
});
