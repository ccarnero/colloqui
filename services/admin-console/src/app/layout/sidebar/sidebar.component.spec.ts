import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { vi } from "vitest";

import { SidebarComponent } from "./sidebar.component";
import { AuthService } from "../../core/services/auth.service";

describe("SidebarComponent", () => {
  let fixture: ComponentFixture<SidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { hasPermission: vi.fn(() => true) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
  });

  it("renders Overview section", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Overview");
  });
});
