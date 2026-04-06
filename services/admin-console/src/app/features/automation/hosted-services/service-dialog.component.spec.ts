import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { vi } from "vitest";
import { RegistryService } from "../../../core/services/registry.service";
import { ServiceDialogComponent } from "./service-dialog.component";

describe("ServiceDialogComponent", () => {
  let fixture: ComponentFixture<ServiceDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: RegistryService,
          useValue: {
            createService: vi.fn(),
            updateService: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ServiceDialogComponent);
    fixture.detectChanges();
  });

  it("renders register title when creating", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Register Service");
  });
});
