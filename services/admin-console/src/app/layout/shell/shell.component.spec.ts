import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterOutlet } from "@angular/router";
import { vi } from "vitest";

import { ShellComponent } from "./shell.component";
import { TenantService } from "../../core/services/tenant.service";

describe("ShellComponent", () => {
  let fixture: ComponentFixture<ShellComponent>;
  let loadTenantDetails: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    loadTenantDetails = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([]),
        {
          provide: TenantService,
          useValue: { loadTenantDetails },
        },
      ],
    })
      .overrideComponent(ShellComponent, {
        set: {
          imports: [RouterOutlet],
          template: "<router-outlet />",
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
  });

  it("calls loadTenantDetails on init", () => {
    expect(loadTenantDetails).toHaveBeenCalled();
  });
});
