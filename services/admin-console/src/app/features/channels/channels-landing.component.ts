import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { Router } from "@angular/router";
import { SectionLandingShellComponent } from "../../shared/components/section-landing-shell/section-landing-shell.component";
import { KpiCardComponent } from "../../shared/components/kpi-card/kpi-card.component";
import {
  ActivityFeedComponent,
  type IActivityEntry,
} from "../../shared/components/activity-feed/activity-feed.component";
import { ChannelsMetricsService } from "../../core/services/metrics/channels-metrics.service";

type ChannelStatus = "ok" | "warn" | "down";

interface IChannelStatus {
  name: string;
  slug: string;
  status: ChannelStatus;
  msgs24h: number;
}

/**
 * Channels section landing.
 *
 * KPIs lean operational (connected/total, messages 24h, hit rate, p95).
 * Primary panel is the per-channel status grid; secondary is recent
 * failed deliveries — both are demo data for Phase 2.
 */
@Component({
  selector: "app-channels-landing",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SectionLandingShellComponent,
    KpiCardComponent,
    ActivityFeedComponent,
  ],
  template: `
    <app-section-landing-shell
      title="Channels"
      subtitle="Mensajería entrante y saliente"
      [hasSecondary]="true"
    >
      <div slot="actions">
        <button class="btn btn-primary" type="button" (click)="newChannel()">
          + Add channel
        </button>
      </div>

      <div slot="kpis" class="kpis">
        <app-kpi-card
          label="Connected"
          [value]="connectedSummary()"
          [sub]="reauthSub()"
        />
        <app-kpi-card
          label="Messages · 24h"
          [value]="messages24hLabel()"
          [sub]="messagesDirSub()"
        />
        <app-kpi-card
          label="Auto-reply hit rate"
          value="68.4%"
          sub="of inbound matched"
          trend="up"
          trendLabel=""
        />
        <app-kpi-card
          label="p95 response"
          value="820ms"
          sub="last 24h"
        />
      </div>

      <div slot="primary" class="panel">
        <h2 class="panel-h">Channels</h2>
        @for (c of channels(); track c.slug) {
          <a class="ch-row" (click)="openChannel(c)">
            <span class="dot" [class]="'dot-' + c.status" aria-hidden="true"></span>
            <span class="ch-name">{{ c.name }}</span>
            <span class="ch-status">{{ statusLabel(c.status) }}</span>
            <span class="ch-msgs">{{ formatNum(c.msgs24h) }} msgs</span>
          </a>
        }
      </div>

      <div slot="secondary" class="panel">
        <h2 class="panel-h">Recent failed deliveries</h2>
        <app-activity-feed [entries]="recentFailures()" />
      </div>
    </app-section-landing-shell>
  `,
  styles: `
    :host {
      display: block;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 14px 16px;
    }
    .panel-h {
      font-size: 13px;
      font-weight: 500;
      margin: 0 0 10px;
      color: var(--text-primary);
    }
    .ch-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 0;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 13px;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
    }
    .ch-row:last-child { border-bottom: none; }
    .ch-row:hover { background: var(--bg3); }
    .dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .dot-ok { background: var(--green, #16a34a); }
    .dot-warn { background: var(--yellow, #eab308); }
    .dot-down { background: var(--red, #ef4444); }
    .ch-name {
      flex: 1;
      color: var(--text-primary);
      font-weight: 500;
    }
    .ch-status { color: var(--text2); width: 110px; }
    .ch-msgs { color: var(--text3); width: 90px; text-align: right; font-variant-numeric: tabular-nums; }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn-primary {
      background: var(--primary, #1a66ff);
      color: #fff;
      border-color: var(--primary, #1a66ff);
    }
    .btn-primary:hover { opacity: 0.9; }
  `,
})
export class ChannelsLandingComponent {
  protected readonly metrics = inject(ChannelsMetricsService);
  private readonly router = inject(Router);

  protected readonly connectedSummary = computed(() => {
    const c = this.metrics.connectedCount();
    const t = this.metrics.totalCount();
    return c === null || t === null ? "—" : `${c}/${t}`;
  });

  protected readonly reauthSub = computed(() => {
    const c = this.metrics.connectedCount();
    const t = this.metrics.totalCount();
    if (c === null || t === null) return "";
    const diff = t - c;
    return diff > 0 ? `${diff} need reauth` : "all healthy";
  });

  protected readonly messages24hLabel = computed(() => {
    const m = (this.metrics.messagesIn24h() ?? 0) + (this.metrics.messagesOut24h() ?? 0);
    return this.formatNum(m);
  });

  protected readonly messagesDirSub = computed(() => {
    const i = this.metrics.messagesIn24h() ?? 0;
    const o = this.metrics.messagesOut24h() ?? 0;
    return `${this.formatNum(i)} in · ${this.formatNum(o)} out`;
  });

  // PHASE 2 DEMO DATA.
  protected readonly channels = computed<IChannelStatus[]>(() => [
    { name: "WhatsApp", slug: "whatsapp", status: "ok", msgs24h: 21_400 },
    { name: "Telegram", slug: "telegram", status: "ok", msgs24h: 8_120 },
    { name: "Auto-Reply", slug: "auto-reply", status: "warn", msgs24h: 4_702 },
    { name: "Web widget", slug: "web", status: "down", msgs24h: 0 },
  ]);

  protected readonly recentFailures = computed<IActivityEntry[]>(() => [
    { time: "1m ago", tone: "danger", html: 'Web widget · WebSocket disconnected · 24 retries' },
    { time: "8m ago", tone: "warn", html: 'WhatsApp · message <strong>5xx</strong> from Meta API' },
    { time: "22m ago", tone: "warn", html: 'Telegram · webhook timeout · auto-retried' },
    { time: "1h ago", tone: "danger", html: 'Web widget · TLS handshake failed' },
  ]);

  protected statusLabel(s: ChannelStatus): string {
    return s === "ok" ? "Connected" : s === "warn" ? "Degraded" : "Down";
  }

  protected formatNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  protected openChannel(c: IChannelStatus): void {
    if (c.slug === "auto-reply") {
      void this.router.navigate(["/auto-reply"]);
    } else {
      void this.router.navigate(["/channels", c.slug]);
    }
  }

  protected newChannel(): void {
    void this.router.navigate(["/channels", "whatsapp"]);
  }
}
