import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NO_ERRORS_SCHEMA } from "@angular/core";
import { of, throwError } from "rxjs";
import { vi, describe, expect, it, beforeEach } from "vitest";
import { ActivatedRoute } from "@angular/router";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";

import { SkbDetailComponent } from "../../../src/app/features/automation/ai/structured-kb/skb-detail.component";
import { StructuredKbService } from "../../../src/app/core/services/structured-kb.service";

describe("SkbDetailComponent", () => {
  let fixture: ComponentFixture<SkbDetailComponent>;
  let component: SkbDetailComponent;
  let mockService: Record<string, ReturnType<typeof vi.fn>>;
  let mockDialog: { open: ReturnType<typeof vi.fn> };
  let mockSnackBar: { open: ReturnType<typeof vi.fn> };

  const sampleContainer = {
    id: "skb-1",
    name: "Product Catalog",
    description: "Product data for queries",
    status: "ready" as const,
    file_count: 2,
    schema: {
      columns: [
        { name: "product_id", type: "integer", description: "Unique product ID", filterable: true },
        { name: "name", type: "text", description: "Product name", filterable: false },
        { name: "price", type: "float", description: "Unit price", filterable: true },
      ],
    },
    created_at: "2025-06-01T10:00:00.000Z",
    updated_at: "2025-06-02T10:00:00.000Z",
  };

  const sampleFiles = [
    { id: "f1", name: "products.csv", status: "ready" as const, row_count: 150, created_at: "2025-06-01T10:00:00.000Z" },
    { id: "f2", name: "categories.csv", status: "processing" as const, row_count: 0, created_at: "2025-06-02T10:00:00.000Z" },
  ];

  const sampleQueryResult = {
    columns: ["product_id", "name", "price"],
    rows: [
      { product_id: 1, name: "Widget", price: 9.99 },
      { product_id: 2, name: "Gadget", price: 19.99 },
    ],
    total: 2,
    sql: "SELECT product_id, name, price FROM data WHERE price > 5",
    duration_ms: 42,
  };

  const sampleHistory = [
    {
      id: "q1",
      query: "Show me all products over $5",
      sql: "SELECT * FROM data WHERE price > 5",
      results_count: 10,
      duration_ms: 35,
      created_at: "2025-06-04T10:00:00.000Z",
    },
    {
      id: "q2",
      query: "Count products by category",
      sql: "SELECT category, COUNT(*) FROM data GROUP BY category",
      results_count: 5,
      duration_ms: 28,
      created_at: "2025-06-04T11:00:00.000Z",
    },
  ];

  beforeEach(async () => {
    mockService = {
      getContainer: vi.fn().mockReturnValue(of(sampleContainer)),
      getFiles: vi.fn().mockReturnValue(of({ files: sampleFiles, total: 2 })),
      query: vi.fn().mockReturnValue(of(sampleQueryResult)),
      getQueryHistory: vi.fn().mockReturnValue(of({ queries: sampleHistory, total: 2 })),
    };
    mockDialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }) };
    mockSnackBar = { open: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SkbDetailComponent],
      providers: [
        { provide: StructuredKbService, useValue: mockService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: { get: () => "skb-1" } },
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(SkbDetailComponent);
    component = fixture.componentInstance;
  });

  it("loads container details and file list on init", () => {
    fixture.detectChanges();
    expect(mockService.getContainer).toHaveBeenCalledWith("skb-1");
    expect(mockService.getFiles).toHaveBeenCalledWith("skb-1");
  });

  it("shows file name, status, row count per file", () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("products.csv");
    expect(el.textContent).toContain("ready");
    expect(el.textContent).toContain("150");
    expect(el.textContent).toContain("categories.csv");
    expect(el.textContent).toContain("processing");
  });

  it("upload file button opens upload dialog", () => {
    fixture.detectChanges();
    component.uploadFile();
    expect(mockDialog.open).toHaveBeenCalled();
  });

  it("schema viewer tab shows column types, descriptions, filterable flags", () => {
    fixture.detectChanges();
    component.activeTab.set("schema");
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("product_id");
    expect(el.textContent).toContain("integer");
    expect(el.textContent).toContain("Unique product ID");
    expect(el.textContent).toContain("filterable");
  });

  it("query tab has text input and search button", () => {
    fixture.detectChanges();
    component.activeTab.set("query");
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector("input[type='text'], textarea") as HTMLInputElement;
    const btn = el.querySelector("button") as HTMLButtonElement;
    expect(input).toBeTruthy();
    expect(btn).toBeTruthy();
  });

  it("query results display in a table with proper columns", () => {
    fixture.detectChanges();
    component.activeTab.set("query");
    component.queryResult.set(sampleQueryResult);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("product_id");
    expect(el.textContent).toContain("name");
    expect(el.textContent).toContain("price");
    expect(el.textContent).toContain("Widget");
    expect(el.textContent).toContain("9.99");
  });

  it("empty results message when query returns nothing", () => {
    fixture.detectChanges();
    component.activeTab.set("query");
    component.queryResult.set({ columns: [], rows: [], total: 0, sql: "", duration_ms: 0 });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("No results found");
  });

  it("loading state during query execution", () => {
    fixture.detectChanges();
    component.activeTab.set("query");
    component.queryLoading.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const spinner = el.querySelector(".spinner") || el.querySelector("[data-testid='query-loading']");
    expect(spinner).toBeTruthy();
  });

  it("error handling for failed queries", () => {
    mockService.query = vi.fn().mockReturnValue(throwError(() => new Error("Query failed")));
    fixture.detectChanges();
    component.activeTab.set("query");
    component.executeQuery("show me products");
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(component.queryError()).toBeTruthy();
  });

  it("history tab shows recent queries with SQL, results count, duration", () => {
    fixture.detectChanges();
    component.activeTab.set("history");
    component.queryHistory.set(sampleHistory);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Show me all products over $5");
    expect(el.textContent).toContain("SELECT * FROM data WHERE price > 5");
    expect(el.textContent).toContain("10");
    expect(el.textContent).toContain("35");
  });
});
