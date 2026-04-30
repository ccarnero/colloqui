import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { Router } from "@angular/router";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { SettingsMetricsService } from "../../core/services/metrics/settings-metrics.service";

interface ISettingsChip {
  label: string;
  route: string;
}

interface ISettingsGroup {
  key: string;
  title: string;
  /** Headline metric or status. May contain inline tone classes via `tone`. */
  headline: string;
  tone: "neutral" | "ok" | "warn" | "danger";
  chips: ISettingsChip[];
  /** When true, card spans full width on the grid (used for Platform). */
  span?: true;
}

/**
 * Settings hub — the special-case landing.
 *
 * Settings has 14 sub-pages spread across 5 conceptual groups (Identity,
 * Tenant, Security, Notifications, Platform). The standard KPI-strip
 * template doesn't fit, so we render a 2-col grid of group cards instead.
 * Each card carries the *single* most action-relevant fact for that
 * group, and the chips below it double as nav.
 */
@Component({
  selector: "app-settings-hub",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent],
  template: `
    <div class="hub">
      <app-page-header
        title="Settings"
        subtitle="Configuración de tenant y plataforma"
      />

      <div class="hub-grid">
        @for (g of groups(); track g.key) {
          <section class="card" [class.card-span]="g.span">
            <header class="card-h">
              <h2 class="card-title">{{ g.title }}</h2>
            </header>
            <p class="card-stat" [class]="'tone-' + g.tone">{{ g.headline }}</p>
            <div class="chips">
              @for (c of g.chips; track c.route) {
                <a class="chip" (click)="go(c.route)">{{ c.label }}</a>
              }
            </div>
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .hub {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .hub-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 900px) {
      .hub-grid {
        grid-template-columns: 1fr;
      }
    }
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card-span {
      grid-column: 1 / -1;
    }
    .card-h {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card-title {
      font-size: 14px;
      font-weight: 500;
      margin: 0;
      color: var(--text-primary);
    }
    .card-stat {
      font-size: 12px;
      color: var(--text2);
      margin: 0;
    }
    .tone-ok { color: var(--green, #16a34a); }
    .tone-warn { color: var(--yellow, #b45309); font-weight: 500; }
    .tone-danger { color: var(--red, #b91c1c); font-weight: 500; }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      font-size: 12px;
      padding: 4px 10px;
      background: var(--bg3);
      color: var(--text2);
      border-radius: var(--radius, 6px);
      cursor: pointer;
      text-decoration: none;
    }
    .chip:hover {
      background: var(--accent-dim, rgba(26, 102, 255, 0.08));
      color: var(--primary, #1a66ff);
    }
  `,
})
export class SettingsHubComponent {
  protected readonly metrics = inject(SettingsMetricsService);
  private readonly router = inject(Router);

  protected readonly groups = computed<ISettingsGroup[]>(() => {
    const users = this.metrics.usersActive() ?? 0;
    const invites = this.metrics.invitationsPending() ?? 0;

    // PHASE 4: trimmed to backed pages only.
    // Identity (Users / Roles / API keys) + Tenant (Billing).
    return [
      {
        key: "identity",
        title: "Identity",
        headline:
          invites > 0
            ? `${users} users · ${invites} invitations pending`
            : `${users} users`,
        tone: invites > 0 ? "warn" : "neutral",
        chips: [
          { label: "Users", route: "/users" },
          { label: "Roles & permissions", route: "/roles" },
          { label: "API keys", route: "/api-keys" },
        ],
      },
      {
        key: "tenant",
        title: "Tenant",
        headline: "Pro plan · renews May 15",
        tone: "neutral",
        span: true,
        chips: [{ label: "Billing", route: "/billing" }],
      },
    ];
  });

  protected go(route: string): void {
    void this.router.navigate([route]);
  }
}
