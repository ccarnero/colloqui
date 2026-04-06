import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { TenantService } from "../../../core/services/tenant.service";
import { MfaComponent } from "./mfa.component";

describe("MfaComponent", () => {
  let fixture: ComponentFixture<MfaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MfaComponent],
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

    fixture = TestBed.createComponent(MfaComponent);
    fixture.detectChanges();
  });

  it("renders MFA title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Multi-Factor Authentication");
  });
});
