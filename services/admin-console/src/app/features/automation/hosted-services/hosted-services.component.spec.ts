import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { RegistryService } from "../../../core/services/registry.service";
import { TenantService } from "../../../core/services/tenant.service";
import { HostedServicesComponent } from "./hosted-services.component";

describe("HostedServicesComponent", () => {
  let fixture: ComponentFixture<HostedServicesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostedServicesComponent],
      providers: [
        {
          provide: RegistryService,
          useValue: {
            loadServices: vi.fn(),
            services: signal([]),
            loading: signal(false),
          },
        },
        {
          provide: TenantService,
          useValue: {
            currentTenant: signal({
              id: "t1",
              name: "Test Tenant",
              configuration: {},
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostedServicesComponent);
    fixture.detectChanges();
  });

  it("renders Hosted Services title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Hosted Services");
  });
});
