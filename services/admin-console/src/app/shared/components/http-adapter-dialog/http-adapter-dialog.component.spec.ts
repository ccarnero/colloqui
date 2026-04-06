import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { vi } from "vitest";
import { HttpAdapterDialogComponent } from "./http-adapter-dialog.component";

describe("HttpAdapterDialogComponent", () => {
  let fixture: ComponentFixture<HttpAdapterDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpAdapterDialogComponent],
      providers: [
        FormBuilder,
        {
          provide: MAT_DIALOG_DATA,
          useValue: { mode: "create" as const },
        },
        {
          provide: MatDialogRef,
          useValue: { close: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HttpAdapterDialogComponent);
    fixture.detectChanges();
  });

  it("renders dialog title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Connector");
  });
});
