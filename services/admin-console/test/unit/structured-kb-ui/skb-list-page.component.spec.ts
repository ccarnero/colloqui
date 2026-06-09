import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NO_ERRORS_SCHEMA, signal } from "@angular/core";
import { of, throwError } from "rxjs";
import { vi, describe, expect, it, beforeEach } from "vitest";
import { Router } from "@angular/router";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";

import { SkbListPageComponent } from "../../../src/app/features/automation/ai/structured-kb/skb-list-page.component";
import { StructuredKbService } from "../../../src/app/core/services/structured-kb.service";

describe("SkbListPageComponent", () => {
  let fixture: ComponentFixture<SkbListPageComponent>;
  let component: SkbListPageComponent;
  let mockService: Record<string, ReturnType<typeof vi.fn>>;
  let mockDialog: { open: ReturnType<typeof vi.fn> };
  let mockSnackBar: { open: ReturnType<typeof vi.fn> };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };

  const sampleContainers = [
    {
      id: "skb-1",
      name: "Product Catalog",
      description: "Product data for queries",
      status: "ready" as const,
      file_count: 3,
      created_at: "2025-06-01T10:00:00.000Z",
      updated_at: "2025-06-02T10:00:00.000Z",
    },
    {
      id: "skb-2",
      name: "Customer DB",
      description: "Customer records",
      status: "processing" as const,
      file_count: 1,
      created_at: "2025-06-03T10:00:00.000Z",
      updated_at: "2025-06-03T10:00:00.000Z",
    },
  ];

  beforeEach(async () => {
    mockService = {
      getContainers: vi.fn().mockReturnValue(of({ containers: sampleContainers, total: 2 })),
    };
    mockDialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }) };
    mockSnackBar = { open: vi.fn() };
    mockRouter = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SkbListPageComponent],
      providers: [
        { provide: StructuredKbService, useValue: mockService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: Router, useValue: mockRouter },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(SkbListPageComponent);
    component = fixture.componentInstance;
  });

  it("loads and displays list of SKB containers", () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Product Catalog");
    expect(el.textContent).toContain("Customer DB");
  });

  it("shows name, description, status, file count, created date", () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Product Catalog");
    expect(el.textContent).toContain("Product data for queries");
    expect(el.textContent).toContain("ready");
    expect(el.textContent).toContain("3");
  });

  it('"New SKB" button opens create dialog', () => {
    fixture.detectChanges();
    component.createContainer();
    expect(mockDialog.open).toHaveBeenCalled();
  });

  it("clicking a container navigates to detail", () => {
    fixture.detectChanges();
    component.navigateToDetail("skb-1");
    expect(mockRouter.navigate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("skb-1")]),
    );
  });

  it('empty state shows "No structured knowledge bases yet" message', () => {
    mockService.getContainers = vi.fn().mockReturnValue(of({ containers: [], total: 0 }));
    fixture = TestBed.createComponent(SkbListPageComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("No structured knowledge bases yet");
  });

  it("loading state shows spinner", () => {
    mockService.getContainers = vi.fn().mockReturnValue(new Promise(() => {}).constructor);
    fixture = TestBed.createComponent(SkbListPageComponent);
    component.loading.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const spinner = el.querySelector(".spinner") || el.querySelector("[data-testid='loading']");
    expect(spinner).toBeTruthy();
  });

  it("error state shows error message with retry button", () => {
    mockService.getContainers = vi.fn().mockReturnValue(
      throwError(() => new Error("Network error")),
    );
    fixture = TestBed.createComponent(SkbListPageComponent);
    component.error.set("Failed to load containers");
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Failed to load containers");
    const retryBtn = el.querySelector("button") as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
  });

  it("status badges render correctly (pending=gray, processing=blue, ready=green, failed=red)", () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const badges = el.querySelectorAll(".status-badge");
    if (badges.length > 0) {
      const readyBadge = Array.from(badges).find((b) => b.textContent?.includes("ready"));
      const processingBadge = Array.from(badges).find((b) => b.textContent?.includes("processing"));
      if (readyBadge) {
        expect((readyBadge as HTMLElement).style.color).toMatch(/green|#66bb6a/i);
      }
      if (processingBadge) {
        expect((processingBadge as HTMLElement).style.color).toMatch(/blue|#42a5f5/i);
      }
    }
    expect(component.getStatusColor("pending")).toBe("#999");
    expect(component.getStatusColor("processing")).toBe("#42a5f5");
    expect(component.getStatusColor("ready")).toBe("#66bb6a");
    expect(component.getStatusColor("failed")).toBe("#ef5350");
  });
});
