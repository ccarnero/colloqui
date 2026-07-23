import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { Router } from "@angular/router";
import { SettingsMetricsService } from "../../core/services/metrics/settings-metrics.service";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";

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
 *
 * Restyled onto `--rd-*` tokens per
 * `manual-loops/admin-console/console-redesign-users-analytics-settings.md`
 * T04 (re-scoped per decision 2 AMENDED (b), human sign-off 2026-07-23,
 * post-T01 finding 3): this component is a nav hub of link cards, not a
 * form — there is no design mock or field set to restyle against, so this
 * task only re-tokens the existing card/chip grid. Structure, routes
 * (`/users`, `/roles`, `/api-keys`, `/billing`), and permission gating are
 * unchanged (T01 finding 5: no permission gating exists on this component
 * today, so none is added here).
 *
 * `usersActive`/`invitationsPending` (from `SettingsMetricsService`) are
 * flagged by T01 finding 3 / the service's own doc comment as
 * "PHASE 2 DEMO SEEDS" — hard-coded placeholder signals, not a live
 * fetch. Behavior is preserved as-is (out of scope to fix here); only the
 * chip/card presentation is restyled.
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
      gap: var(--rd-space-6, 12px);
    }
    .hub-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--rd-space-6, 12px);
    }
    @media (max-width: 900px) {
      .hub-grid {
        grid-template-columns: 1fr;
      }
    }
    .card {
      background: var(--rd-panel);
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-5, 6px);
      padding: var(--rd-space-7, 14px) var(--rd-space-8, 16px);
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-5, 10px);
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
      font-size: var(--rd-text-size-md, 14px);
      font-weight: 500;
      margin: 0;
      color: var(--rd-text-1);
    }
    .card-stat {
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-2);
      margin: 0;
    }
    .tone-ok {
      color: var(--rd-green);
    }
    .tone-warn {
      color: var(--rd-yellow);
      font-weight: 500;
    }
    .tone-danger {
      color: var(--rd-red);
      font-weight: 500;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--rd-space-3, 6px);
    }
    .chip {
      font-size: var(--rd-text-size-sm, 12px);
      padding: 4px var(--rd-space-5, 10px);
      background: var(--rd-hover);
      color: var(--rd-text-2);
      border-radius: var(--rd-radius-5, 6px);
      cursor: pointer;
      text-decoration: none;
    }
    .chip:hover {
      background: var(--rd-accent-soft);
      color: var(--rd-link);
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
    // Verbose logging: restyled chip nav path, T04 (SPEC line 55).
    console.debug("[SettingsHubComponent] chip clicked, navigating", {
      route,
    });
    void this.router.navigate([route]);
  }
}
