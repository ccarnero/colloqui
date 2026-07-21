import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import {
  InventoryTableColumn,
  InventoryTableComponent,
} from "./inventory-table.component";

interface IRow {
  id: string;
  name: string;
  status: string;
  trend: number[];
}

const rows: IRow[] = [
  { id: "1", name: "Soporte MX", status: "connected", trend: [1, 2, 3] },
  { id: "2", name: "Ventas AR", status: "error", trend: [3, 2, 1] },
];

const columns: InventoryTableColumn<IRow>[] = [
  { key: "name", header: "Cuenta", type: "text", value: (r) => r.name },
  { key: "id", header: "ID", type: "mono", value: (r) => r.id },
  {
    key: "status",
    header: "Estado",
    type: "status-badge",
    value: (r) => r.status,
  },
  {
    key: "trend",
    header: "Msgs",
    type: "sparkline",
    value: (r) => r.trend,
  },
];

describe("InventoryTableComponent", () => {
  let fixture: ComponentFixture<InventoryTableComponent<IRow>>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryTableComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(InventoryTableComponent<IRow>);
  });

  function setInputs(
    overrides: Partial<{
      columns: InventoryTableColumn<IRow>[];
      rows: IRow[];
    }> = {}
  ): void {
    fixture.componentRef.setInput("columns", overrides.columns ?? columns);
    fixture.componentRef.setInput("rows", overrides.rows ?? rows);
    fixture.detectChanges();
  }

  it("renders one header cell per column", () => {
    setInputs();
    const el = fixture.nativeElement as HTMLElement;
    const headers = Array.from(el.querySelectorAll(".table-header-cell")).map(
      (n) => n.textContent
    );
    expect(headers).toEqual(["Cuenta", "ID", "Estado", "Msgs"]);
  });

  it("renders one row per data item with status-badge and sparkline cell renderers", () => {
    setInputs();
    const el = fixture.nativeElement as HTMLElement;
    const dataRows = el.querySelectorAll(".table-row");
    expect(dataRows.length).toBe(2);
    expect(el.querySelector("app-status-badge")).toBeTruthy();
    expect(el.querySelector("app-sparkline")).toBeTruthy();
  });

  it("emits rowClick with the clicked row on click", () => {
    setInputs();
    const emitted: IRow[] = [];
    fixture.componentInstance.rowClick.subscribe((row) => emitted.push(row));

    const el = fixture.nativeElement as HTMLElement;
    const firstRow = el.querySelector(".table-row") as HTMLElement;
    firstRow.click();

    expect(emitted).toEqual([rows[0]]);
  });

  it("renders an empty state and logs when there are no rows (does not fail silently)", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    setInputs({ rows: [] });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".table-empty")).toBeTruthy();
    expect(el.querySelectorAll(".table-row").length).toBe(0);
    expect(debugSpy).toHaveBeenCalled();
  });
});
