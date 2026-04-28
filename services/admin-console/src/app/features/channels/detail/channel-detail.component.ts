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
import { AuthService } from "../../../core/services/auth.service";
import type {
  IUsageBucketRow,
  IUsageTotalsRow,
  UsageBucket,
} from "../../../core/models/channel-streams.model";
import {
  RangeSelectorComponent,
  type IUsageRangeSelection,
  type UsagePresetRange,
} from "./range-selector.component";
import {
  UsageChartComponent,
  type IUsageChartRange,
} from "./usage-chart.component";
import { KpiCardsComponent } from "./kpi-cards.component";
import { ScopedStreamCardsComponent } from "./scoped-stream-cards.component";
import {
  MessageInspectorDialogComponent,
  type IMessageInspectorDialogData,
} from "./message-inspector-dialog.component";

interface IRangeSpec {
  readonly durationMs: number;
  readonly bucket: UsageBucket;
}

interface IResolvedUsageRange {
  readonly from: string;
  readonly to: string;
  readonly bucket: UsageBucket;
  readonly label: string;
}

const RANGE_SPECS: ReadonlyMap<UsagePresetRange, IRangeSpec> = new Map<
  UsagePresetRange,
  IRangeSpec
>([
  ["6h", { durationMs: 6 * 60 * 60 * 1000, bucket: "hour" }],
  ["24h", { durationMs: 24 * 60 * 60 * 1000, bucket: "hour" }],
  ["7d", { durationMs: 7 * 24 * 60 * 60 * 1000, bucket: "day" }],
  ["30d", { durationMs: 30 * 24 * 60 * 60 * 1000, bucket: "day" }],
]);

const DEFAULT_PRESET_RANGE: UsagePresetRange = "24h";
const MAX_USAGE_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CUSTOM_RANGE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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
    ScopedStreamCardsComponent,
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
          [value]="rangeSelection()"
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
      <h3 class="section-title">Totals ({{ rangeLabel() }})</h3>
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
          <app-usage-chart
            [data]="usage()"
            [range]="resolvedRangeForChart()"
            [hasRecentActivity]="hasRecentActivity()"
          />
        </div>
      }
    </section>

    <section class="section">
      <h3 class="section-title">Streams (this account)</h3>
      <app-scoped-stream-cards
        [totals]="totals()"
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
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);

  private readonly destroy$ = new Subject<void>();

  readonly channel = signal<string>("");
  readonly accountId = signal<string>("");
  readonly rangeSelection = signal<IUsageRangeSelection>({
    mode: "preset",
    preset: DEFAULT_PRESET_RANGE,
  });

  readonly usage = signal<ReadonlyArray<IUsageBucketRow>>([]);
  readonly totals = signal<ReadonlyArray<IUsageTotalsRow>>([]);
  readonly loading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly resolvedRange = signal<IResolvedUsageRange | null>(null);

  readonly hasRecentActivity = computed<boolean>(() =>
    this.totals().some((row) => row.events > 0),
  );

  readonly resolvedRangeForChart = computed<IUsageChartRange | null>(() => {
    const r = this.resolvedRange();
    if (!r) return null;
    return { from: r.from, to: r.to, bucket: r.bucket };
  });

  readonly rangeLabel = computed<string>(() =>
    this.formatRangeSelectionLabel(this.rangeSelection()),
  );

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

  onRangeChange(next: IUsageRangeSelection): void {
    this.rangeSelection.set(next);
    this.reload();
  }

  reload(): void {
    const accountId = this.accountId();
    const channel = this.channel();
    if (!accountId || !channel) return;

    let resolved: IResolvedUsageRange;
    try {
      resolved = this.resolveRange(this.rangeSelection());
    } catch (err: unknown) {
      this.errorMessage.set(
        err instanceof Error ? err.message : "Invalid date range",
      );
      this.loading.set(false);
      return;
    }

    this.resolvedRange.set(resolved);
    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      usage: this.channels.getUsage({
        from: resolved.from,
        to: resolved.to,
        bucket: resolved.bucket,
        accountId,
        channel,
      }),
      totals: this.channels.getUsageTotals({
        from: resolved.from,
        to: resolved.to,
        accountId,
        channel,
      }),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ usage, totals }) => {
          this.usage.set(usage.items);
          this.totals.set(totals.items);
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
    const basePattern = this.defaultStreamSubjectPattern(streamKey);
    const channelFilter = this.buildChannelScopedFilter(
      basePattern,
      this.channel(),
    );
    const data: IMessageInspectorDialogData = {
      streamKey,
      streamName: streamKey === "ingress" ? "Ingress" : "DLQ",
      defaultSubject: channelFilter,
      subjectPlaceholder:
        channelFilter || basePattern || "e.g. evt.<tenant>.>",
      accountId: this.accountId() || undefined,
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

  /**
   * JetStream streams bind `evt.<tenant>.>` or `dlq.<tenant>.>` — same
   * shape as {@link getTenantStreamName} / DLQ subjects in `@yoizen/shared`.
   */
  private defaultStreamSubjectPattern(streamKey: "ingress" | "dlq"): string {
    const tid = this.auth.tenantId();
    if (!tid) return "";
    return streamKey === "ingress" ? `evt.${tid}.>` : `dlq.${tid}.>`;
  }

  private resolveRange(selection: IUsageRangeSelection): IResolvedUsageRange {
    if (selection.mode === "custom") {
      if (!selection.from || !selection.to) {
        throw new Error("Custom range requires start and end dates");
      }
      const fromDate = new Date(selection.from);
      const toDate = new Date(selection.to);
      if (
        Number.isNaN(fromDate.getTime()) ||
        Number.isNaN(toDate.getTime())
      ) {
        throw new Error("Invalid custom date range");
      }
      if (fromDate >= toDate) {
        throw new Error("Start date must be before end date");
      }
      const durationMs = toDate.getTime() - fromDate.getTime();
      if (durationMs > MAX_USAGE_RANGE_MS) {
        throw new Error("Date range exceeds 90 days");
      }
      return {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        bucket: this.pickBucket(durationMs),
        label: this.formatCustomRangeLabel(fromDate, toDate),
      };
    }

    const preset = selection.preset ?? DEFAULT_PRESET_RANGE;
    const spec = RANGE_SPECS.get(preset) ?? RANGE_SPECS.get(DEFAULT_PRESET_RANGE)!;
    const now = Date.now();
    return {
      from: new Date(now - spec.durationMs).toISOString(),
      to: new Date(now).toISOString(),
      bucket: spec.bucket,
      label: preset,
    };
  }

  private pickBucket(durationMs: number): UsageBucket {
    return durationMs <= DAY_MS ? "hour" : "day";
  }

  private formatRangeSelectionLabel(selection: IUsageRangeSelection): string {
    if (selection.mode !== "custom") {
      return selection.preset ?? DEFAULT_PRESET_RANGE;
    }
    if (!selection.from || !selection.to) return "Custom";
    const fromDate = new Date(selection.from);
    const toDate = new Date(selection.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return "Custom";
    }
    return this.formatCustomRangeLabel(fromDate, toDate);
  }

  private formatCustomRangeLabel(from: Date, to: Date): string {
    return `${CUSTOM_RANGE_FORMATTER.format(from)} - ${CUSTOM_RANGE_FORMATTER.format(to)}`;
  }
}
