import { TitleCasePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { forkJoin, Subject, takeUntil } from "rxjs";
import type { IChannelAccount } from "../../../core/models/channel-account.model";
import type {
  IUsageBucketRow,
  IUsageTotalsRow,
  UsageBucket,
} from "../../../core/models/channel-streams.model";
import { AuthService } from "../../../core/services/auth.service";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";
import { MessageTraceService } from "../../../core/services/message-trace.service";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../../shared/components/confirm-dialog/confirm-dialog.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import {
  type HealthStatus,
  StatusBadgeComponent,
} from "../../../shared/components/status-badge/status-badge.component";
import type { IRecentTrace } from "../../processes/trace/domain/message-trace.model";
import {
  AccountDialogComponent,
  type IAccountDialogResult,
} from "../account-dialog.component";
import { KpiCardsComponent } from "./kpi-cards.component";
import {
  type IMessageInspectorDialogData,
  MessageInspectorDialogComponent,
} from "./message-inspector-dialog.component";
import {
  type IUsageRangeSelection,
  RangeSelectorComponent,
  type UsagePresetRange,
} from "./range-selector.component";
import { ScopedStreamCardsComponent } from "./scoped-stream-cards.component";
import {
  type IUsageChartRange,
  UsageChartComponent,
} from "./usage-chart.component";

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

const DIAGNOSTICS_PERMISSION = "diagnostics:read";

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
    PageHeaderComponent,
    StatusBadgeComponent,
    RangeSelectorComponent,
    UsageChartComponent,
    KpiCardsComponent,
    ScopedStreamCardsComponent,
  ],
  template: `
    <div class="ws-breadcrumb">
      <a [routerLink]="['/channels', channel()]" class="breadcrumb-link">
        <mat-icon>arrow_back</mat-icon>
        {{ channel() | titlecase }} accounts
      </a>
    </div>

    <app-page-header
      [title]="headerTitle()"
      subtitle="Usage metrics and JetStream activity for this account."
    >
      <ng-container slot="actions">
        @if (account(); as acc) {
          <span class="account-meta">
            <span class="account-meta-chip">{{ acc.channel }}</span>
            <span class="account-meta-chip">{{ acc.externalId }}</span>
          </span>
          <app-status-badge
            [status]="accountStatusLabel()"
            variant="dot"
            [health]="accountHealth()"
          />
          <button mat-stroked-button type="button" (click)="openEdit()">
            <mat-icon>edit</mat-icon>
            Edit
          </button>
          <button
            mat-stroked-button
            type="button"
            color="warn"
            (click)="confirmDelete()"
          >
            <mat-icon>delete</mat-icon>
            Delete
          </button>
        }
        <app-range-selector
          [value]="rangeSelection()"
          (valueChange)="onRangeChange($event)"
        />
        <button mat-stroked-button type="button" (click)="reload()">
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
      </ng-container>
    </app-page-header>

    @if (accountNotFound()) {
      <div class="error-banner">
        Account not found. It may have been deleted.
      </div>
    }

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

    @if (canViewTraces()) {
      <section class="section">
        <h3 class="section-title">Recent messages</h3>
        @if (tracesLoading()) {
          <div class="loader">
            <mat-spinner diameter="24"></mat-spinner>
            <span>Loading recent messages…</span>
          </div>
        } @else if (recentTraces().length === 0) {
          <p class="no-traces">No recent messages in the last hour.</p>
        } @else {
          <div class="trace-list">
            @for (t of recentTraces(); track t.correlationId) {
              <a class="trace-row"
                 [routerLink]="['/processes/trace', t.correlationId]">
                <span class="trace-ts">{{ t.lastAt }}</span>
                <span class="trace-verdict">{{ t.verdict }}</span>
                <span class="trace-id">{{ shortCorrelationId(t.correlationId) }}</span>
              </a>
            }
          </div>
        }
      </section>
    }
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
    .account-meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .account-meta-chip {
      font-family: var(--rd-font-mono, monospace);
      font-size: 11px;
      color: var(--rd-text-3, var(--text3));
      border: 1px solid var(--rd-line, var(--border));
      border-radius: 6px;
      padding: 2px 8px;
    }
    .error-banner {
      background: var(--rd-red-dim);
      border: 1px solid var(--rd-red);
      color: var(--rd-red);
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
    .no-traces {
      color: var(--text3);
      font-size: 13px;
      margin: 0;
    }
    .trace-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .trace-row {
      display: flex;
      gap: 16px;
      align-items: center;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      text-decoration: none;
      color: var(--text);
      font-size: 13px;
    }
    .trace-row:hover {
      background: var(--bg2);
    }
    .trace-ts {
      color: var(--text3);
      font-size: 12px;
      min-width: 190px;
      font-family: var(--font-mono, monospace);
    }
    .trace-verdict {
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 6px;
      background: var(--bg2);
      white-space: nowrap;
    }
    .trace-id {
      font-family: var(--font-mono, monospace);
      color: var(--text3);
      font-size: 12px;
    }
  `,
})
export class ChannelDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly channels = inject(ChannelAdminService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly traceService = inject(MessageTraceService);

  readonly recentTraces = signal<IRecentTrace[]>([]);
  readonly tracesLoading = signal(false);
  readonly canViewTraces = computed(() =>
    this.auth.hasPermission(DIAGNOSTICS_PERMISSION)
  );

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

  /**
   * Account entity for the header (name/channel/identity/status, T01
   * finding 4/12 - never fetched by this component before). There is no
   * per-account GET endpoint (T01 finding 8), so the account is resolved
   * by listing all accounts and matching the route's `accountId`.
   */
  readonly account = signal<IChannelAccount | null>(null);
  readonly accountLoading = signal<boolean>(false);
  readonly accountNotFound = signal<boolean>(false);

  readonly headerTitle = computed(() => {
    const acc = this.account();
    return acc ? acc.name : `Account ${this.accountId()}`;
  });

  readonly accountStatusLabel = computed(() => {
    const acc = this.account();
    return acc ? (acc.isActive ? "Active" : "Inactive") : "";
  });

  // Mapping A (decision 3, DECIDED 2026-07-22, T01 finding 10):
  // isActive === true -> ok, isActive === false -> error. warn/idle are
  // unreachable - no backend degradation signal exists today.
  readonly accountHealth = computed<HealthStatus>(() =>
    this.account()?.isActive ? "ok" : "error"
  );

  readonly hasRecentActivity = computed<boolean>(() =>
    this.totals().some((row) => row.events > 0)
  );

  readonly resolvedRangeForChart = computed<IUsageChartRange | null>(() => {
    const r = this.resolvedRange();
    if (!r) {
      return null;
    }
    return { from: r.from, to: r.to, bucket: r.bucket };
  });

  readonly rangeLabel = computed<string>(() =>
    this.formatRangeSelectionLabel(this.rangeSelection())
  );

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.channel.set(params.get("channel") ?? "");
      this.accountId.set(params.get("accountId") ?? "");
      this.reload();
      this.loadAccount();
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
    if (!accountId || !channel) {
      return;
    }

    let resolved: IResolvedUsageRange;
    try {
      resolved = this.resolveRange(this.rangeSelection());
    } catch (err: unknown) {
      this.errorMessage.set(
        err instanceof Error ? err.message : "Invalid date range"
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
            err instanceof Error ? err.message : "Failed to load channel detail"
          );
          this.loading.set(false);
        },
      });
    this.loadRecentTraces();
  }

  /**
   * Resolves the account entity backing this detail view. `listAccounts()`
   * is the only account-read endpoint (T01 finding 8, no new endpoints
   * per constraint 4) - accounts are fetched in full and matched by id.
   * An id with no match sets the not-found state instead of failing
   * silently.
   */
  loadAccount(): void {
    const accountId = this.accountId();
    if (!accountId) {
      return;
    }
    this.accountLoading.set(true);
    this.accountNotFound.set(false);
    this.channels
      .listAccounts()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (accounts) => {
          const found = accounts.find((a) => a.id === accountId) ?? null;
          this.account.set(found);
          this.accountLoading.set(false);
          if (found === null) {
            this.accountNotFound.set(true);
            console.error(
              "[ChannelDetailComponent] account not found for route params",
              { accountId, channel: this.channel() }
            );
          } else {
            console.debug("[ChannelDetailComponent] account resolved", {
              accountId,
              name: found.name,
              isActive: found.isActive,
            });
          }
        },
        error: (err: unknown) => {
          this.accountLoading.set(false);
          this.accountNotFound.set(true);
          console.error("[ChannelDetailComponent] failed to load account", {
            accountId,
            error: err,
          });
        },
      });
  }

  /**
   * Edit action (ADDED 2026-07-22, human sign-off post-T02): reuses
   * AccountDialogComponent's edit mode exactly as the fleet table did
   * before the actions column was removed.
   */
  openEdit(): void {
    const acc = this.account();
    if (!acc) {
      console.error(
        "[ChannelDetailComponent] edit requested with no account loaded"
      );
      return;
    }
    console.debug("[ChannelDetailComponent] opening account edit dialog", {
      accountId: acc.id,
    });
    const ref = this.dialog.open(AccountDialogComponent, {
      data: { account: acc },
      width: "520px",
    });
    ref.afterClosed().subscribe((result?: IAccountDialogResult) => {
      if (result?.saved) {
        console.debug(
          "[ChannelDetailComponent] account updated, reloading account",
          { accountId: acc.id }
        );
        this.loadAccount();
      }
    });
  }

  /**
   * Delete action (ADDED 2026-07-22, human sign-off post-T02): confirms
   * via the existing confirm-dialog pattern, then deletes and navigates
   * back to the fleet list on success.
   */
  confirmDelete(): void {
    const acc = this.account();
    if (!acc) {
      console.error(
        "[ChannelDetailComponent] delete requested with no account loaded"
      );
      return;
    }
    const data: IConfirmDialogData = {
      title: "Delete Account",
      message: `Delete account "${acc.name}"?\n\nThis will also delete all auto-reply rules and messages for this account.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
      icon: "delete_forever",
    };
    console.debug("[ChannelDetailComponent] delete confirmation requested", {
      accountId: acc.id,
    });
    this.dialog
      .open<ConfirmDialogComponent, IConfirmDialogData, boolean>(
        ConfirmDialogComponent,
        { data }
      )
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed === true) {
          this.deleteAccount(acc);
        } else {
          console.debug("[ChannelDetailComponent] delete cancelled", {
            accountId: acc.id,
          });
        }
      });
  }

  private deleteAccount(acc: IChannelAccount): void {
    this.channels.deleteAccount(acc.id).subscribe({
      next: () => {
        console.debug(
          "[ChannelDetailComponent] account deleted, navigating back to fleet",
          { accountId: acc.id, channel: this.channel() }
        );
        this.router
          .navigate(["/channels", this.channel()])
          .catch((error: unknown) => {
            console.error(
              "[ChannelDetailComponent] navigation back to fleet failed",
              { accountId: acc.id, error }
            );
          });
      },
      error: (err: unknown) => {
        console.error("[ChannelDetailComponent] failed to delete account", {
          accountId: acc.id,
          error: err,
        });
      },
    });
  }

  openInspector(streamKey: "ingress" | "dlq"): void {
    const basePattern = this.defaultStreamSubjectPattern(streamKey);
    const channelFilter = this.buildChannelScopedFilter(
      basePattern,
      this.channel()
    );
    const data: IMessageInspectorDialogData = {
      streamKey,
      streamName: streamKey === "ingress" ? "Ingress" : "DLQ",
      defaultSubject: channelFilter,
      subjectPlaceholder: channelFilter || basePattern || "e.g. evt.<tenant>.>",
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
    channel: string
  ): string {
    if (!basePattern || !channel) {
      return "";
    }
    if (!basePattern.endsWith(".>")) {
      return "";
    }
    const prefix = basePattern.slice(0, basePattern.length - 1); // keeps trailing dot
    return `${prefix}channel-service.messaging.${channel}.>`;
  }

  /**
   * JetStream streams bind `evt.<tenant>.>` or `dlq.<tenant>.>` — same
   * shape as {@link getTenantStreamName} / DLQ subjects in `@yoizen/shared`.
   */
  private defaultStreamSubjectPattern(streamKey: "ingress" | "dlq"): string {
    const tid = this.auth.tenantId();
    if (!tid) {
      return "";
    }
    return streamKey === "ingress" ? `evt.${tid}.>` : `dlq.${tid}.>`;
  }

  private resolveRange(selection: IUsageRangeSelection): IResolvedUsageRange {
    if (selection.mode === "custom") {
      if (!selection.from || !selection.to) {
        throw new Error("Custom range requires start and end dates");
      }
      const fromDate = new Date(selection.from);
      const toDate = new Date(selection.to);
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
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
    const spec =
      RANGE_SPECS.get(preset) ?? RANGE_SPECS.get(DEFAULT_PRESET_RANGE)!;
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
    if (!selection.from || !selection.to) {
      return "Custom";
    }
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

  private loadRecentTraces(): void {
    if (!this.canViewTraces()) {
      return;
    }
    const accountId = this.accountId();
    const channel = this.channel();
    if (!accountId || !channel) {
      return;
    }

    this.tracesLoading.set(true);
    this.traceService
      .recentTraces(60, 20, { accountId, channel })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.recentTraces.set(rows);
          this.tracesLoading.set(false);
        },
        error: () => {
          this.recentTraces.set([]);
          this.tracesLoading.set(false);
        },
      });
  }

  shortCorrelationId(id: string): string {
    return id.length > 10 ? `${id.slice(0, 8)}…` : id;
  }
}
