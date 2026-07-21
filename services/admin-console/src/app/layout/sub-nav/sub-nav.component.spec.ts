import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { vi } from "vitest";
import { NavIndicatorRegistry } from "../../core/services/metrics/nav-indicator-registry.service";
import { NAV_SECTIONS } from "../nav/nav.config";
import { SubNavComponent } from "./sub-nav.component";

@Component({ selector: "app-test-blank", template: "" })
class BlankTestComponent {}

describe("SubNavComponent", () => {
  let fixture: ComponentFixture<SubNavComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubNavComponent],
      providers: [
        provideRouter([{ path: "dashboard", component: BlankTestComponent }]),
        {
          provide: NavIndicatorRegistry,
          useValue: { resolve: vi.fn(() => null) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SubNavComponent);
  });

  it("renders the pages of the section matching the current URL", async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl("/dashboard");
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const overviewSection = NAV_SECTIONS.find((s) => s.key === "overview")!;

    for (const page of overviewSection.pages) {
      expect(el.textContent).toContain(page.label);
    }
  });

  it("renders nothing when the URL matches no known section", () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("nav.sub-nav")).toBeFalsy();
  });

  it("applies the collapsed class when the collapsed input is true", async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl("/dashboard");
    fixture.componentRef.setInput("collapsed", true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("nav.sub-nav.collapsed")).toBeTruthy();
  });
});
