import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { TitleCasePipe } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { Subject, forkJoin, takeUntil } from "rxjs";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";
import type {
  IStreamSummary,
  IUsageBucketRow,
  IUsageTotalsRow,
  UsageBucket,
} from "../../../core/models/channel-streams.model";
import {
  RangeSelectorComponent,
  type UsageRange,
} from "./range-selector.component";
import { UsageChartComponent } from "./usage-chart.component";
import { KpiCardsComponent } from "./kpi-cards.component";
import { StreamMetaCardsComponent } from "./stream-meta-cards.component";
import {
  MessageInspectorDialogComponent,
  type IMessageInspectorDialogData,
} from "./message-inspector-dialog.component";

interface IRangeSpec {
  readonly durationMs: number;
  readonly bucket: UsageBucket;
}

const RANGE_SPECS: ReadonlyMap<UsageRange, IRangeSpec> = new Map<
  UsageRange,
  IRangeSpec
>([
  ["1h", { durationMs: 60 * 60 * 1000, bucket: "hour" }],
  ["6h", { durationMs: 6 * 60 * 60 * 1000, bucket: "hour" }],
  ["24h", { durationMs: 24 * 60 * 60 * 1000, bucket: "hour" }],
  ["7d", { durationMs: 7 * 24 * 60 * 60 * 1000, bucket: "day" }],
  ["30d", { durationMs: 30 * 24 * 60 * 60 * 1000, bucket: "day" }],
]);

@Component({
  selector: "app-channel-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TitleCasePipe,
    RouterLink,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RangeSelectorComponent,
    UsageChartComponent,
    KpiCardsComponent,
    StreamMetaCardsComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-breadcrumb">
          <a [routerLink]="['/channels', channel()]" class="breadcrumb-link">
            <mat-icon>arrow_back</mat-icon>
            {{ channel() | titlecase }} accounts
          </a>
        </div>
        <div class="ws-title">Account {{ accountId() }}</div>
        <div class="ws-subtitle">
          Usage metrics and JetStream activity for this account.
        </div>
      </div>
      <div class="ws-actions">
        <app-range-selector
          [value]="range()"
          (valueChange)="onRangeChange($event)"
        />
        <button mat-stroked-button type="button" (click)="reload()">
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
      </div>
    </div>

    @if (errorMessage()) {
      <div class="error-banner">{{ errorMessage() }}</div>
    }

    <section class="section">
      <h3 class="section-title">Totals ({{ range() }})</h3>
      <app-kpi-cards [totals]="totals()" />
    </section>

    <section class="section">
      <h3 class="section-title">Activity over time</h3>
      @if (loading()) {
        <div class="loader">
          <mat-spinner diameter="24"></mat-spinner>
          <span>Loading usage…</span>
        </div>
      } @else {
        <div class="chart-wrap">
          <app-usage-chart [data]="usage()" />
        </div>
      }
    </section>

    <section class="section">
      <h3 class="section-title">Streams</h3>
      <app-stream-meta-cards
        [streams]="streams()"
        (inspect)="openInspector($event)"
      />
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .ws-breadcrumb {
      margin-bottom: 4px;
    }
    .breadcrumb-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text3);
      font-size: 12px;
      text-decoration: none;
    }
    .breadcrumb-link:hover {
      color: var(--text);
    }
    .ws-actions {
      display: inline-flex;
      align-items: center;
      gap: 12px;
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #ef4444;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .section {
      margin-top: 24px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 12px;
    }
    .chart-wrap {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .loader {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text3);
      padding: 24px;
    }
  `,
})
export class ChannelDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly channels = inject(ChannelAdminService);
  private readonly dialog = inject(MatDialog);

  private readonly destroy$ = new Subject<void>();

  readonly channel = signal<string>("");
  readonly accountId = signal<string>("");
  readonly range = signal<UsageRange>("24h");

  readonly usage = signal<ReadonlyArray<IUsageBucketRow>>([]);
  readonly totals = signal<ReadonlyArray<IUsageTotalsRow>>([]);
  readonly streams = signal<ReadonlyArray<IStreamSummary>>([]);

  readonly loading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  readonly rangeSpec = computed<IRangeSpec>(() => {
    const spec = RANGE_SPECS.get(this.range());
    if (!spec) {
      return { durationMs: 24 * 60 * 60 * 1000, bucket: "hour" };
    }
    return spec;
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.channel.set(params.get("channel") ?? "");
      this.accountId.set(params.get("accountId") ?? "");
      this.reload();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onRangeChange(next: UsageRange): void {
    this.range.set(next);
    this.reload();
  }

  reload(): void {
    const accountId = this.accountId();
    const channel = this.channel();
    if (!accountId || !channel) return;

    const now = Date.now();
    const spec = this.rangeSpec();
    const from = new Date(now - spec.durationMs).toISOString();
    const to = new Date(now).toISOString();

    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      usage: this.channels.getUsage({
        from,
        to,
        bucket: spec.bucket,
        accountId,
        channel,
      }),
      totals: this.channels.getUsageTotals({
        from,
        to,
        accountId,
        channel,
      }),
      streams: this.channels.getStreams(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ usage, totals, streams }) => {
          this.usage.set(usage.items);
          this.totals.set(totals.items);
          this.streams.set(streams.items);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.errorMessage.set(
            err instanceof Error ? err.message : "Failed to load channel detail",
          );
          this.loading.set(false);
        },
      });
  }

  openInspector(streamKey: "ingress" | "dlq"): void {
    const stream = this.streams().find((s) => s.kind === streamKey);
    if (!stream) return;
    const basePattern = stream.subjects[0] ?? "";
    const channelFilter = this.buildChannelScopedFilter(
      basePattern,
      this.channel(),
    );
    const data: IMessageInspectorDialogData = {
      streamKey,
      streamName: stream.name,
      defaultSubject: channelFilter,
      subjectPlaceholder:
        channelFilter || basePattern || "e.g. evt.<tenant>.>",
    };
    this.dialog.open(MessageInspectorDialogComponent, {
      data,
      width: "min(1100px, 95vw)",
      maxWidth: "95vw",
    });
  }

  /**
   * Derives a filter like `evt.<tenant>.channel-service.messaging.<channel>.>`
   * from the stream's `evt.<tenant>.>` (or `dlq.<tenant>.>`) base pattern, so
   * the inspector opens pre-scoped to the channel the user is inspecting.
   * Returns empty string when the base pattern doesn't follow the expected
   * shape — the dialog will then fall back to the stream's full pattern.
   */
  private buildChannelScopedFilter(
    basePattern: string,
    channel: string,
  ): string {
    if (!basePattern || !channel) return "";
    if (!basePattern.endsWith(".>")) return "";
    const prefix = basePattern.slice(0, basePattern.length - 1); // keeps trailing dot
    return `${prefix}channel-service.messaging.${channel}.>`;
  }
}
