import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { TenantService } from "../../../core/services/tenant.service";
import { BillingComponent } from "./billing.component";

describe("BillingComponent", () => {
  let fixture: ComponentFixture<BillingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BillingComponent],
      providers: [
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

    fixture = TestBed.createComponent(BillingComponent);
    fixture.detectChanges();
  });

  it("renders Billing & Plans title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Billing & Plans");
  });
});
