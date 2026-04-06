import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { TenantService } from "../../../core/services/tenant.service";
import { AnalyticsComponent } from "./analytics.component";

describe("AnalyticsComponent", () => {
  let fixture: ComponentFixture<AnalyticsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsComponent],
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

    fixture = TestBed.createComponent(AnalyticsComponent);
    fixture.detectChanges();
  });

  it("renders Analytics title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Analytics");
  });
});
