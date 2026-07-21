import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { NAV_SECTIONS } from "../nav/nav.config";

const LOG_PREFIX = "[SidebarComponent]";

/**
 * Restyled per the redesign contract (manual-loops/admin-console/design/
 * Rediseño Terminal.dc.html — sub-rail pattern). The nav model is the
 * shared `NAV_SECTIONS` from `layout/nav/nav.config.ts` (user decision 5):
 * sections and their pages are rendered verbatim, in the order declared
 * there — this component must never reorder/add/remove sections.
 */
@Component({
  selector: "app-sidebar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, MatIconModule],
  template: `
    <aside class="rd-sidebar">
      <div class="rd-brand">
        <span class="rd-brand-mark">Y</span>
        <span class="rd-brand-text">Admin Console</span>
      </div>

      <nav class="rd-nav">
        @for (section of sections; track section.key) {
          <div class="rd-nav-section">
            <button
              type="button"
              class="rd-section-label"
              [class.collapsed]="!isSectionExpanded(section.key)"
              (click)="toggleSection(section.key)"
            >
              <span>{{ section.label }}</span>
              <mat-icon class="rd-section-chevron">
                {{ isSectionExpanded(section.key) ? "expand_less" : "expand_more" }}
              </mat-icon>
            </button>
            @if (isSectionExpanded(section.key)) {
              <div class="rd-section-items">
                @for (page of section.pages; track page.route) {
                  <a
                    class="rd-nav-item"
                    [routerLink]="page.route"
                    routerLinkActive="active"
                    [routerLinkActiveOptions]="{ exact: page.route === '/dashboard' }"
                  >
                    <span>{{ page.label }}</span>
                  </a>
                }
              </div>
            }
          </div>
        }
      </nav>
    </aside>
  `,
  styles: `
    .rd-sidebar {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--rd-panel);
    }

    .rd-brand {
      height: 52px;
      padding: 0 var(--rd-space-11);
      display: flex;
      align-items: center;
      gap: var(--rd-space-6);
      border-bottom: 1px solid var(--rd-line);
      flex-shrink: 0;
    }

    .rd-brand-mark {
      width: 22px;
      height: 22px;
      border-radius: var(--rd-radius-6);
      background: var(--rd-accent);
      color: var(--rd-text-on-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--rd-text-size-xs);
      font-weight: 700;
      flex-shrink: 0;
    }

    .rd-brand-text {
      color: var(--rd-text-1);
      font-weight: 600;
      font-size: var(--rd-text-size-lg);
      letter-spacing: -0.02em;
    }

    .rd-nav {
      flex: 1 1 0%;
      overflow-y: auto;
      padding: var(--rd-space-6) 0 var(--rd-space-10);
      scrollbar-width: thin;
      scrollbar-color: var(--rd-line) transparent;
    }

    .rd-nav-section {
      margin-bottom: var(--rd-space-2);
    }

    .rd-section-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      border: none;
      background: none;
      font-family: inherit;
      font-size: var(--rd-text-size-2xs);
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--rd-text-3);
      text-transform: uppercase;
      padding: var(--rd-space-5) var(--rd-space-8) var(--rd-space-2);
      cursor: pointer;
      transition: color 0.1s;
    }

    .rd-section-label:hover {
      color: var(--rd-text-2);
    }

    .rd-section-label.collapsed {
      padding-bottom: var(--rd-space-4);
    }

    .rd-section-chevron {
      font-size: 14px;
      width: 14px;
      height: 14px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .rd-nav-section:hover .rd-section-chevron,
    .rd-section-label.collapsed .rd-section-chevron {
      opacity: 0.6;
    }

    .rd-section-items {
      overflow: hidden;
    }

    .rd-nav-item {
      display: flex;
      align-items: center;
      gap: var(--rd-space-5);
      padding: var(--rd-space-3) var(--rd-space-8);
      margin: 0 var(--rd-space-4);
      border-radius: var(--rd-radius-5);
      cursor: pointer;
      color: var(--rd-text-2);
      font-size: var(--rd-text-size-base);
      font-weight: 400;
      text-decoration: none;
      transition: background 0.1s, color 0.1s;
    }

    .rd-nav-item:hover {
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }

    .rd-nav-item.active {
      background: var(--rd-hover);
      color: var(--rd-text-1);
      font-weight: 500;
    }
  `,
})
export class SidebarComponent {
  /** Nav model per user decision 5 — sourced verbatim from nav.config.ts. */
  protected readonly sections = NAV_SECTIONS;

  private readonly expandedSections = new Set<string>(
    NAV_SECTIONS.map((section) => section.key)
  );

  toggleSection(key: string): void {
    if (this.expandedSections.has(key)) {
      this.expandedSections.delete(key);
      console.debug(`${LOG_PREFIX} collapsed section "${key}"`);
    } else {
      this.expandedSections.add(key);
      console.debug(`${LOG_PREFIX} expanded section "${key}"`);
    }
  }

  isSectionExpanded(key: string): boolean {
    return this.expandedSections.has(key);
  }
}
