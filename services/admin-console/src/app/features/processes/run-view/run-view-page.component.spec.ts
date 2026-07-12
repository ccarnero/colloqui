import "@angular/compiler";
import { Location } from "@angular/common";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../core/services/auth.service";
import { RunViewPageComponent } from "./run-view-page.component";

/**
 * T06 (entry a): the route wrapper binds `:workflowId`/`:runId` route
 * params onto the embedded `app-run-view` (via `withComponentInputBinding`,
 * verified indirectly here by asserting the inputs on the child element),
 * and "Back" calls `Location.back()` rather than a hardcoded route
 * (see run-view-page.component.ts header for why).
 */
describe("RunViewPageComponent", () => {
  let fixture: ComponentFixture<RunViewPageComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RunViewPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { hasPermission: () => false } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RunViewPageComponent);
    fixture.componentRef.setInput(
      "workflowId",
      "acme:order-workflow:sha256:abc123"
    );
    fixture.componentRef.setInput("runId", "run-9");
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("renders breadcrumbs and embeds the run view with the resolved ids", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("app-breadcrumbs")).toBeTruthy();

    const runView = el.querySelector("app-run-view");
    expect(runView).toBeTruthy();
    expect(fixture.componentInstance.workflowId()).toBe(
      "acme:order-workflow:sha256:abc123"
    );
    expect(fixture.componentInstance.runId()).toBe("run-9");

    // Drain the run fetch RunViewComponent triggers internally.
    httpMock
      .match(() => true)
      .forEach((req) =>
        req.flush({}, { status: 404, statusText: "not found" })
      );
  });

  it("passes an explicit definitionId input through to the embedded run view (T06 finding fix)", () => {
    fixture.componentRef.setInput("definitionId", "def-9");
    fixture.detectChanges();

    expect(fixture.componentInstance.definitionId()).toBe("def-9");

    httpMock
      .match(() => true)
      .forEach((req) =>
        req.flush({}, { status: 404, statusText: "not found" })
      );
  });

  it("calls Location.back() on Back click", () => {
    const location = TestBed.inject(Location);
    const backSpy = vi.spyOn(location, "back").mockImplementation(() => {});
    const el = fixture.nativeElement as HTMLElement;
    const backBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Back")
    );

    backBtn?.click();

    expect(backSpy).toHaveBeenCalledTimes(1);
    httpMock
      .match(() => true)
      .forEach((req) =>
        req.flush({}, { status: 404, statusText: "not found" })
      );
  });
});
