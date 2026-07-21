import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { vi } from "vitest";
import {
  DetailDialogComponent,
  IDetailDialogData,
} from "./detail-dialog.component";

describe("DetailDialogComponent", () => {
  let fixture: ComponentFixture<DetailDialogComponent>;
  const dialogRef = { close: vi.fn() };

  function createFixture(data: IDetailDialogData): void {
    dialogRef.close.mockReset();
    TestBed.configureTestingModule({
      imports: [DetailDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    });
    fixture = TestBed.createComponent(DetailDialogComponent);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("renders with the redesign token classes and the dialog title/subtitle", () => {
    createFixture({
      title: "Soporte MX",
      subtitle: "whatsapp · account",
      fields: [{ label: "id", value: "acc_123" }],
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".dialog-title")?.textContent).toBe("Soporte MX");
    expect(el.querySelector(".dialog-subtitle")?.textContent).toBe(
      "whatsapp · account"
    );
    // Restyled per redesign tokens: dialog structure carries the classes
    // covered by the `.rd-dialog-panel` global theme in styles.scss.
    expect(el.querySelector(".dialog-header")).toBeTruthy();
    expect(el.querySelector(".dialog-close")).toBeTruthy();
  });

  it("renders one dt/dd pair per field", () => {
    createFixture({
      title: "Ventas AR",
      fields: [
        { label: "id", value: "acc_456" },
        { label: "status", value: "active" },
      ],
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll("dt").length).toBe(2);
    expect(el.querySelectorAll("dd").length).toBe(2);
    expect(el.querySelector("dd")?.textContent).toBe("acc_456");
  });

  it("closes the dialog when the close button is clicked", () => {
    createFixture({ title: "Ventas AR", fields: [] });

    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector(".dialog-close") as HTMLElement).click();

    expect(dialogRef.close).toHaveBeenCalled();
  });

  it("renders an empty state and logs when there are no fields (does not fail silently)", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    createFixture({ title: "Ventas AR", fields: [] });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".dialog-empty")).toBeTruthy();
    expect(debugSpy).toHaveBeenCalled();
  });
});
