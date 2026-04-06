import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { TenantService } from "../../../core/services/tenant.service";
import { ApiKeysComponent } from "./api-keys.component";

describe("ApiKeysComponent", () => {
  let fixture: ComponentFixture<ApiKeysComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ApiKeysComponent],
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

    fixture = TestBed.createComponent(ApiKeysComponent);
    fixture.detectChanges();
  });

  it("renders API Keys title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("API Keys");
  });
});
