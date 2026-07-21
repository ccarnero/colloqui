import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { NAV_SECTIONS } from "../nav/nav.config";
import { SidebarComponent } from "./sidebar.component";

describe("SidebarComponent", () => {
  let fixture: ComponentFixture<SidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
  });

  it("renders Overview section", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Overview");
  });

  it("renders the nav.config sections in order", () => {
    const el = fixture.nativeElement as HTMLElement;
    const labels = Array.from(
      el.querySelectorAll<HTMLElement>(".rd-section-label span")
    ).map((span) => span.textContent?.trim());

    expect(labels).toEqual(NAV_SECTIONS.map((section) => section.label));
  });

  it("renders every page link for each nav.config section", () => {
    const el = fixture.nativeElement as HTMLElement;
    const totalPages = NAV_SECTIONS.reduce(
      (sum, section) => sum + section.pages.length,
      0
    );
    const links = el.querySelectorAll<HTMLAnchorElement>(".rd-nav-item");

    expect(links.length).toBe(totalPages);
  });
});
