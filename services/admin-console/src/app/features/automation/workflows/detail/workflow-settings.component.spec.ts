import "@angular/compiler";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { ActivatedRoute, Router } from "@angular/router";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { IWorkflowDefinitionDto } from "../services/workflow-api.service";
import { WorkflowSettingsComponent } from "./workflow-settings.component";

const wf: IWorkflowDefinitionDto = {
  id: "wf1",
  name: "My Workflow",
  application: "app1",
  tenantId: "t1",
  actions: [],
  trigger: null,
  status: "enabled",
  createdAt: new Date().toISOString(),
};

/**
 * Enable/disable toggle moved here from `workflows.component.ts` (T02
 * review objection fix): the list is read-only per
 * `design/10-workflows.png`, and this Settings tab is now the single
 * place that exercises `WorkflowApiService.setStatus`. These three
 * specs are the ones moved (and adapted) from
 * `workflows.component.spec.ts`'s former "status toggle" describe
 * block, plus a new failure-surfacing regression test.
 */
describe("WorkflowSettingsComponent status toggle", () => {
  let fixture: ComponentFixture<WorkflowSettingsComponent>;
  let httpMock: HttpTestingController;

  async function setup(dialogAfterClosed: unknown) {
    const dialogSpy = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(dialogAfterClosed),
      }),
    };

    await TestBed.configureTestingModule({
      imports: [WorkflowSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: dialogSpy },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            parent: {
              params: of({ id: "wf1" }),
              snapshot: { params: { id: "wf1" } },
            },
            params: of({}),
            snapshot: { params: {} },
          },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowSettingsComponent);
    fixture.detectChanges();

    httpMock.expectOne("/api/workflows/wf1").flush(wf);
    fixture.detectChanges();

    return dialogSpy;
  }

  it("opens the confirm dialog and calls setStatus when disabling is confirmed", async () => {
    await setup(true);
    (
      fixture.componentInstance as unknown as {
        onStatusToggle: (checked: boolean, wf: IWorkflowDefinitionDto) => void;
      }
    ).onStatusToggle(false, wf);

    const req = httpMock.expectOne("/api/workflows/wf1/status");
    expect(req.request.method).toBe("PATCH");
    expect(req.request.body).toEqual({ status: "disabled" });
    req.flush({ ...wf, status: "disabled", terminated: 2 });

    fixture.detectChanges();
    httpMock.verify();
  });

  it("does not call setStatus when disabling is cancelled", async () => {
    await setup(false);
    (
      fixture.componentInstance as unknown as {
        onStatusToggle: (checked: boolean, wf: IWorkflowDefinitionDto) => void;
      }
    ).onStatusToggle(false, wf);

    httpMock.expectNone("/api/workflows/wf1/status");
    httpMock.verify();
  });

  it("calls setStatus directly with no dialog when enabling", async () => {
    const dialogSpy = await setup(true);
    (
      fixture.componentInstance as unknown as {
        onStatusToggle: (checked: boolean, wf: IWorkflowDefinitionDto) => void;
      }
    ).onStatusToggle(true, wf);

    expect(dialogSpy.open).not.toHaveBeenCalled();
    const req = httpMock.expectOne("/api/workflows/wf1/status");
    expect(req.request.body).toEqual({ status: "enabled" });
    req.flush({ ...wf, status: "enabled", terminated: 0 });

    fixture.detectChanges();
    httpMock.verify();
  });

  it("shows a visible error and logs to console when setStatus fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await setup(true);
    (
      fixture.componentInstance as unknown as {
        onStatusToggle: (checked: boolean, wf: IWorkflowDefinitionDto) => void;
      }
    ).onStatusToggle(true, wf);

    const req = httpMock.expectOne("/api/workflows/wf1/status");
    req.flush({ message: "boom" }, { status: 500, statusText: "Server Error" });

    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(
      "Couldn't update workflow status. Please try again."
    );
    expect(consoleErrorSpy).toHaveBeenCalled();

    httpMock.verify();
    consoleErrorSpy.mockRestore();
  });
});
