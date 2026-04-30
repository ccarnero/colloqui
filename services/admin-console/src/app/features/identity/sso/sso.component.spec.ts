import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { TenantService } from "../../../core/services/tenant.service";
import { SsoComponent } from "./sso.component";

describe("SsoComponent", () => {
  let fixture: ComponentFixture<SsoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SsoComponent],
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

    fixture = TestBed.createComponent(SsoComponent);
    fixture.detectChanges();
  });

  it("renders SSO title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Single Sign-On (SSO)");
  });
});
