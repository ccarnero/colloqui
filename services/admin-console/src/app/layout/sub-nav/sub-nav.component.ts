import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from "@angular/core";
import { Router, RouterLink, RouterLinkActive, NavigationEnd } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs/operators";
import { NAV_SECTIONS } from "../nav/nav.config";

@Component({
  selector: "app-sub-nav",
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    @if (activeSection(); as section) {
      <nav
        class="sub-nav"
        [class.mobile-open]="mobileOpen()"
        [attr.aria-label]="section.label + ' navigation'"
      >
        @for (page of section.pages; track page.route) {
          @if (page.dividerBefore) {
            <div class="nav-divider"></div>
          }
          <a
            class="nav-item"
            [routerLink]="page.route"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: page.route === '/dashboard' }"
            (click)="mobileClose.emit()"
          >{{ page.label }}</a>
        }
      </nav>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .sub-nav {
      width: 180px;
      min-width: 180px;
      border-right: 1px solid var(--border-subtle);
      padding: 12px 0;
      background: var(--bg-surface);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--border-subtle) transparent;
    }

    .nav-item {
      display: block;
      font-size: 13px;
      font-weight: 400;
      padding: 7px 20px;
      color: var(--text2);
      text-decoration: none;
      border-left: 2px solid transparent;
      transition: color 0.12s, background 0.12s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .nav-item:hover {
      color: var(--text-primary);
      background: var(--bg3);
    }

    .nav-item.active {
      color: var(--primary, #1a66ff);
      background: var(--accent-dim, rgba(26, 102, 255, 0.06));
      border-left-color: var(--primary, #1a66ff);
      font-weight: 500;
    }

    .nav-divider {
      height: 1px;
      background: var(--border-subtle);
      margin: 6px 0;
    }

    @media (max-width: 900px) {
      .sub-nav {
        position: fixed;
        top: 56px;
        left: -200px;
        bottom: 0;
        z-index: 40;
        transition: transform 0.25s ease;
        width: 200px;
        min-width: 200px;
      }

      .sub-nav.mobile-open {
        transform: translateX(200px);
        box-shadow: 4px 0 20px rgba(0, 0, 0, 0.15);
      }
    }
  `,
})
export class SubNavComponent {
  private readonly router = inject(Router);

  readonly mobileOpen = input(false);
  readonly mobileClose = output<void>();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly activeSection = computed(() => {
    const url = this.url();
    return (
      NAV_SECTIONS.find((s) =>
        s.matchPaths.some((p) => url === p || url.startsWith(p + "/")),
      ) ?? null
    );
  });
}
