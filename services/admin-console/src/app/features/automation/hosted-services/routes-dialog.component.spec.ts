import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA } from "@angular/material/dialog";
import { of } from "rxjs";
import { vi } from "vitest";
import { RegistryService } from "../../../core/services/registry.service";
import { RoutesDialogComponent } from "./routes-dialog.component";

describe("RoutesDialogComponent", () => {
  let fixture: ComponentFixture<RoutesDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoutesDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { serviceId: "svc-1", serviceName: "payments-api" },
        },
        {
          provide: RegistryService,
          useValue: {
            listRoutes: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RoutesDialogComponent);
    fixture.detectChanges();
  });

  it("renders routes header with service name", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Routes for");
    expect(el.textContent).toContain("payments-api");
  });
});
