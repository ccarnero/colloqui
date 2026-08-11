import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { Router } from "@angular/router";
import { ChannelsMetricsService } from "../../core/services/metrics/channels-metrics.service";
import {
  ActivityFeedComponent,
  type IActivityEntry,
} from "../../shared/components/activity-feed/activity-feed.component";
import { KpiCardComponent } from "../../shared/components/kpi-card/kpi-card.component";
import { SectionLandingShellComponent } from "../../shared/components/section-landing-shell/section-landing-shell.component";

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
 * An aggregate dashboard, not a channel index — navigation lives in the left
 * rail. KPIs (connected/total, messages 24h) + traffic-by-channel + recent
 * failed deliveries (needs-attention).
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
          value="—"
          sub="metrics coming soon"
        />
        <app-kpi-card
          label="p95 response"
          value="—"
          sub="metrics coming soon"
        />
      </div>

      <div slot="primary" class="panel">
        <h2 class="panel-h">Traffic by channel · 24h</h2>
        @for (c of channels(); track c.slug) {
          <div class="tr-row">
            <div class="tr-head">
              <span>
                <span
                  class="dot"
                  [class]="'dot-' + c.status"
                  aria-hidden="true"
                ></span>
                {{ c.name }}
              </span>
              <span class="tr-num">{{ formatNum(c.msgs24h) }}</span>
            </div>
            <div class="tr-bar">
              <span class="tr-fill" [style.width.%]="barPct(c.msgs24h)"></span>
            </div>
          </div>
        }
        <p class="tr-hint">
          Open a channel from the left rail to manage its accounts.
        </p>
      </div>

      <div slot="secondary" class="panel">
        <h2 class="panel-h">Recent failed deliveries</h2>
        <app-activity-feed
          [entries]="recentFailures()"
          emptyText="No recent failures"
        />
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
    .tr-row {
      padding: 9px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .tr-row:last-of-type { border-bottom: none; }
    .tr-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 13px;
      margin-bottom: 6px;
      color: var(--text-primary);
    }
    .tr-bar {
      height: 8px;
      border-radius: 6px;
      background: var(--bg3, #ececec);
      overflow: hidden;
    }
    .tr-fill {
      display: block;
      height: 100%;
      background: var(--primary, #1a66ff);
      border-radius: 6px;
    }
    .tr-hint { font-size: 12px; color: var(--text3); margin: 12px 0 0; }
    .dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .dot-ok { background: var(--green, #16a34a); }
    .dot-warn { background: var(--yellow, #eab308); }
    .dot-down { background: var(--red, #ef4444); }
    .tr-num { color: var(--text3); font-variant-numeric: tabular-nums; }
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

  constructor() {
    this.metrics.loadCounts();
    this.metrics.loadUsageTotals();
  }

  protected readonly connectedSummary = computed(() => {
    const c = this.metrics.connectedCount();
    const t = this.metrics.totalCount();
    return c === null || t === null ? "—" : `${c}/${t}`;
  });

  protected readonly reauthSub = computed(() => {
    const c = this.metrics.connectedCount();
    const t = this.metrics.totalCount();
    if (c === null || t === null) {
      return "";
    }
    const diff = t - c;
    return diff > 0 ? `${diff} need reauth` : "all healthy";
  });

  protected readonly messages24hLabel = computed(() => {
    const i = this.metrics.messagesIn24h();
    const o = this.metrics.messagesOut24h();
    if (i === null && o === null) {
      return "—";
    }
    return this.formatNum((i ?? 0) + (o ?? 0));
  });

  protected readonly messagesDirSub = computed(() => {
    const i = this.metrics.messagesIn24h();
    const o = this.metrics.messagesOut24h();
    if (i === null && o === null) {
      return "";
    }
    return `${this.formatNum(i ?? 0)} in · ${this.formatNum(o ?? 0)} out`;
  });

  protected readonly channels = computed<IChannelStatus[]>(() => [
    {
      name: "Telegram",
      slug: "telegram",
      status: "ok",
      msgs24h: this.metrics.telegramTraffic() ?? 0,
    },
    {
      name: "HTTP",
      slug: "http",
      status: "ok",
      msgs24h: this.metrics.httpTraffic() ?? 0,
    },
  ]);

  protected barPct(msgs: number): number {
    const max = Math.max(...this.channels().map((c) => c.msgs24h), 1);
    return Math.round((msgs / max) * 100);
  }

  protected readonly recentFailures = computed<IActivityEntry[]>(() => []);

  protected formatNum(n: number): string {
    if (n >= 1_000_000) {
      return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 1_000) {
      return `${(n / 1_000).toFixed(1)}K`;
    }
    return String(n);
  }

  protected newChannel(): void {
    void this.router.navigate(["/channels", "telegram"]);
  }
}
