import { Component, EventEmitter, Input, Output } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router, RouterOutlet } from "@angular/router";
import { vi } from "vitest";
import { TenantService } from "../../core/services/tenant.service";
import { ShellComponent } from "./shell.component";

describe("ShellComponent", () => {
  let fixture: ComponentFixture<ShellComponent>;
  let loadTenantDetails: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    loadTenantDetails = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([]),
        {
          provide: TenantService,
          useValue: { loadTenantDetails },
        },
      ],
    })
      .overrideComponent(ShellComponent, {
        set: {
          imports: [RouterOutlet],
          template: "<router-outlet />",
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
  });

  it("calls loadTenantDetails on init", () => {
    expect(loadTenantDetails).toHaveBeenCalled();
  });
});

/**
 * Stand-ins for the real `app-header`/`app-sub-nav` so this suite can mount
 * ShellComponent's REAL template (unlike the describe block above, which
 * strips it down) and assert on the `subNavHidden` full-bleed behavior
 * without pulling in HeaderComponent's full provider graph (auth, theme,
 * notifications, tenant, etc.) — SPEC console-redesign-processes-builder.md
 * T03, decision 3 amendment 2026-07-22 (header/tabs stay, only the sub-nav
 * hides for the full-bleed builder route).
 */
@Component({
  selector: "app-header",
  standalone: true,
  template: `<div data-testid="stub-header">header</div>`,
})
class StubHeaderComponent {
  @Output() toggleSidebar = new EventEmitter<void>();
}

@Component({
  selector: "app-sub-nav",
  standalone: true,
  template: `<div data-testid="stub-sub-nav">sub-nav</div>`,
})
class StubSubNavComponent {
  @Input() mobileOpen = false;
  @Input() collapsed = false;
  @Output() mobileClose = new EventEmitter<void>();
}

@Component({ selector: "app-test-blank", template: "blank" })
class BlankTestComponent {}

describe("ShellComponent — full-bleed sub-nav visibility (T03)", () => {
  let fixture: ComponentFixture<ShellComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([
          {
            path: "workflows",
            children: [
              { path: "plain", component: BlankTestComponent },
              {
                path: "builder",
                component: BlankTestComponent,
                data: { subNavHidden: true },
              },
            ],
          },
        ]),
        {
          provide: TenantService,
          useValue: { loadTenantDetails: vi.fn() },
        },
      ],
    })
      .overrideComponent(ShellComponent, {
        set: {
          imports: [RouterOutlet, StubHeaderComponent, StubSubNavComponent],
        },
      })
      .compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(ShellComponent);
  });

  it("keeps the header but hides the sub-nav on a subNavHidden route", async () => {
    await router.navigateByUrl("/workflows/builder");
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="stub-header"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="stub-sub-nav"]')).toBeFalsy();
    expect(el.querySelector("main.shell-main.full-bleed")).toBeTruthy();
  });

  it("shows the sub-nav on a route without subNavHidden", async () => {
    await router.navigateByUrl("/workflows/plain");
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="stub-sub-nav"]')).toBeTruthy();
    expect(el.querySelector("main.shell-main.full-bleed")).toBeFalsy();
  });

  it("restores the sub-nav after navigating away from the builder route", async () => {
    await router.navigateByUrl("/workflows/builder");
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="stub-sub-nav"]')
    ).toBeFalsy();

    await router.navigateByUrl("/workflows/plain");
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="stub-sub-nav"]')).toBeTruthy();
    expect(el.querySelector("main.shell-main.full-bleed")).toBeFalsy();
  });
});
