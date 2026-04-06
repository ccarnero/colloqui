import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { TenantService } from "../../../core/services/tenant.service";
import { GroupsComponent } from "./groups.component";

describe("GroupsComponent", () => {
  let fixture: ComponentFixture<GroupsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupsComponent],
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

    fixture = TestBed.createComponent(GroupsComponent);
    fixture.detectChanges();
  });

  it("renders Groups title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Groups");
  });
});
