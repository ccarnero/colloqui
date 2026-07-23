import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { ActivatedRoute, Router } from "@angular/router";
import { environment } from "../../../environments/environment";
import type { IChannelAccount } from "../../core/models/channel-account.model";
import { AuthService } from "../../core/services/auth.service";
import { ChannelAdminService } from "../../core/services/channel-admin.service";
import {
  type InventoryTableColumn,
  InventoryTableComponent,
} from "../../shared/components/inventory-table/inventory-table.component";
import { KpiCardComponent } from "../../shared/components/kpi-card/kpi-card.component";
import type {
  AttentionSeverity,
  IAttentionIssue,
} from "../../shared/components/needs-attention-panel/needs-attention-panel.component";
import { NeedsAttentionPanelComponent } from "../../shared/components/needs-attention-panel/needs-attention-panel.component";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import type { HealthStatus } from "../../shared/components/status-badge/status-badge.component";
import { formatCompact } from "../../shared/utils/format-compact";
import {
  AccountDialogComponent,
  type IAccountDialogResult,
} from "./account-dialog.component";

/**
 * Severity used for the fleet needs-attention panel. Only isActive=false
 * accounts are surfaced here (Mapping A, decision 3) - there is no data
 * source for the design's other severities (error-code spikes, webhook
 * p95), so this feature always emits "critical".
 */
const INACTIVE_ATTENTION_SEVERITY: AttentionSeverity = "critical";

@Component({
  selector: "app-channels",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    PageHeaderComponent,
    KpiCardComponent,
    InventoryTableComponent,
    NeedsAttentionPanelComponent,
  ],
  template: `
    <app-page-header title="Channels" subtitle="Manage channel accounts">
      <ng-container slot="actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="openCreate()"
        >
          <mat-icon>add</mat-icon>
          Add channel
        </button>
      </ng-container>
    </app-page-header>

    @if (isHttp()) {
      <div class="section-card" style="padding: 16px; margin-bottom: 16px;">
        <p style="font-weight: 600; margin-bottom: 6px;">
          Send messages to this channel
        </p>
        <p class="muted" style="margin-bottom: 10px;">
          Each HTTP account has its <strong>own ingest URL</strong> - the account's
          <span class="mono">externalId</span> is the last path segment. POST JSON to it
          with that account's webhook token (the <strong>App Secret</strong> shown when
          you connect the account). Same flow as the
          <span class="mono">sdk/examples/reference-pattern</span> example.
        </p>
        @for (a of filteredAccounts(); track a.id) {
          <div style="margin-bottom: 12px;">
            <p class="mono" style="font-size: 12px; margin: 0 0 4px;">
              {{ a.name }} <span class="muted">- {{ a.externalId }}</span>
            </p>
            <pre
              class="mono"
              style="background: var(--rd-panel); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; white-space: pre; margin: 0;"
            >{{ ingestCurlFor(a) }}</pre>
          </div>
        } @empty {
          <p class="muted" style="font-size: 12px; margin: 0;">
            Connect an HTTP account to get its dedicated ingest URL.
          </p>
        }
      </div>
    }

    @if (loading()) {
      <div class="fleet-strip fleet-strip--loading">
        <div class="fleet-skeleton"></div>
      </div>
      <div class="table-wrap" style="padding: 32px; text-align: center;">
        <mat-spinner diameter="32" />
        <p style="margin-top: 12px; color: var(--rd-text-3);">
          Loading accounts...
        </p>
      </div>
    } @else if (error()) {
      <div class="alert alert-error">
        <mat-icon>error_outline</mat-icon>
        <div>
          <strong>Failed to load accounts</strong>
          <p style="margin-top: 4px;">{{ error() }}</p>
          <button
            class="btn btn-secondary btn-sm"
            style="margin-top: 8px;"
            (click)="loadAccounts()"
          >
            Retry
          </button>
        </div>
      </div>
    } @else {
      <!-- Fleet strip, design: Rediseno Terminal.dc.html lines 257-278.
           Only "messages 24h" has a real per-channel data source
           (ChannelAdminService.getUsageTotals scoped by channel, T01
           finding 11). Delivery rate / conversations-15min / first-response
           are flagged NO-DATA in T01 finding 11 and are NOT rendered.
           Account totals (also real, T01 finding 3) are kept as the
           existing stat cards this view already exposed. -->
      <div class="fleet-strip">
        <app-kpi-card
          label="Messages - 24h"
          [value]="formattedMessages24h()"
          [sub]="messagesDirSub()"
        />
        <app-kpi-card label="Active accounts" [value]="activeAccounts()" />
        <app-kpi-card label="Inactive accounts" [value]="inactiveAccounts()" />
      </div>

      <!-- Accounts inventory, design: lines 280-299. Health dot uses
           Mapping A (decision 3, DECIDED 2026-07-22): isActive maps to
           ok/error, no warn/idle (unreachable, no data source). Msgs 24h,
           sparkline, delivery, first-response and workflows columns are
           dropped - T01 finding 11 flags all of them as having no
           per-account data source. -->
      <app-inventory-table
        [columns]="accountColumns"
        [rows]="filteredAccounts()"
        ariaLabel="Channel accounts"
        [emptyMessage]="emptyAccountsMessage()"
        (rowClick)="onAccountRowClick($event)"
      />

      <!-- Needs attention, design: lines 302-329 (left column only; the
           Actividad column and warn-severity items have no data source,
           T01 finding 11). Only isActive=false accounts are real
           degradation signals (T01 finding 10). -->
      <app-needs-attention-panel
        title="Needs attention"
        subtitle="this channel"
        [issues]="attentionIssues()"
        emptyMessage="No accounts need attention"
        (actionClick)="onAttentionActionClick($event)"
      />
    }
  `,
  styles: `
    .fleet-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--rd-space-8, 16px);
      margin-bottom: var(--rd-space-8, 16px);
    }
    .fleet-strip--loading {
      opacity: 0.4;
    }
    .fleet-skeleton {
      grid-column: 1 / -1;
      height: 72px;
      border-radius: var(--rd-radius-7, 8px);
      background: var(--rd-line);
    }
    app-inventory-table {
      display: block;
      margin-bottom: var(--rd-space-8, 16px);
    }
    .mono {
      font-family: var(--rd-font-mono);
    }
    .muted {
      color: var(--rd-text-3);
    }
  `,
})
export class ChannelsComponent implements OnInit {
  private readonly channels = inject(ChannelAdminService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly channelFilter = signal("whatsapp");
  readonly accounts = signal<IChannelAccount[]>([]);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly messagesIn24h = signal<number | null>(null);
  readonly messagesOut24h = signal<number | null>(null);

  readonly filteredAccounts = computed(() =>
    this.accounts().filter((a) => a.channel === this.channelFilter())
  );

  readonly activeAccounts = computed(
    () => this.filteredAccounts().filter((a) => a.isActive).length
  );
  readonly inactiveAccounts = computed(
    () => this.filteredAccounts().filter((a) => !a.isActive).length
  );

  readonly isHttp = computed(() => this.channelFilter() === "http");

  readonly emptyAccountsMessage = computed(
    () =>
      `No accounts found. Connect your first ${this.channelFilter()} account to get started.`
  );

  readonly formattedMessages24h = computed(() => {
    const inCount = this.messagesIn24h();
    const outCount = this.messagesOut24h();
    if (inCount === null || outCount === null) {
      return "-";
    }
    return formatCompact(inCount + outCount);
  });

  readonly messagesDirSub = computed(() => {
    const inCount = this.messagesIn24h();
    const outCount = this.messagesOut24h();
    if (inCount === null || outCount === null) {
      return undefined;
    }
    return formatCompact(inCount) + " in - " + formatCompact(outCount) + " out";
  });

  /**
   * Fleet inventory table columns. See the class-level template comment
   * for the design/data-source mapping (T01 finding 11).
   *
   * T01 finding 3, FIX (T05): reorder/rename columns closer to the mock's
   * CUENTA/IDENTIDAD/ESTADO/MSGS-24H set (Account/Identity/Status) using
   * only real fields - the msgs-24h/sparkline cells stay DATA-GAP (same
   * finding, no per-account time-bucketed series exists). Channel and
   * Created are dropped: Channel is implied by the page context (a
   * single-channel fleet view) and Created has no slot in the mock.
   */
  readonly accountColumns: InventoryTableColumn<IChannelAccount>[] = [
    {
      key: "account",
      header: "Account",
      type: "status-badge",
      variant: "dot",
      value: (a) => a.name,
      // Mapping A (decision 3, DECIDED 2026-07-22, T01 finding 10):
      // isActive === true -> ok, isActive === false -> error. warn/idle
      // are unreachable - no backend degradation signal exists today.
      health: (a): HealthStatus => (a.isActive ? "ok" : "error"),
    },
    {
      key: "externalId",
      header: "Identity",
      type: "mono",
      value: (a) => a.externalId,
    },
    {
      key: "status",
      header: "Status",
      type: "text",
      // Existing status text (channels.component.ts prior art, T01 finding
      // 3): isActive maps to Active/Inactive. No richer "needs reauth"
      // state is derivable from the fields available today (T01 finding 11).
      value: (a) => (a.isActive ? "Active" : "Inactive"),
      width: "110px",
    },
  ];

  readonly attentionIssues = computed<IAttentionIssue[]>(() => {
    const inactive = this.filteredAccounts().filter((a) => !a.isActive);
    if (inactive.length === 0) {
      // Verbose logging: empty attention list must not fail silently.
      console.debug(
        "[ChannelsComponent] no inactive accounts, needs-attention panel will render its empty state",
        { channel: this.channelFilter() }
      );
    }
    return inactive.map((a) => ({
      id: a.id,
      message: `${a.name} is inactive and not receiving messages.`,
      severity: INACTIVE_ATTENTION_SEVERITY,
      action: { label: "View account" },
    }));
  });

  /**
   * Per-instance ingest URL: the account externalId is the last path
   * segment (/api/webhooks/http/{tenant}/{externalId}), so each HTTP
   * account is its own addressable endpoint.
   */
  private ingestUrlFor(externalId: string): string {
    const tenant = this.auth.tenantId() ?? "<tenant>";
    return `${window.location.origin}${environment.apiUrl}/webhooks/http/${tenant}/${externalId}`;
  }

  ingestCurlFor(account: IChannelAccount): string {
    const token = account.appSecret ?? "<app-secret>";
    return (
      `curl -X POST ${this.ingestUrlFor(account.externalId)} \\\n` +
      `  -H 'content-type: application/json' \\\n` +
      `  -H 'x-http-channel-token: ${token}' \\\n` +
      `  -d '{"from":"customer@example.com","text":"hello"}'`
    );
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.channelFilter.set(params.get("channel") ?? "whatsapp");
      this.loadAccounts();
      this.loadUsageTotals();
    });
  }

  openCreate(): void {
    const ref = this.dialog.open(AccountDialogComponent, {
      data: { defaultChannel: this.channelFilter() },
      width: "520px",
    });
    ref.afterClosed().subscribe((result?: IAccountDialogResult) => {
      if (result?.saved) {
        this.loadAccounts();
      }
    });
  }

  /**
   * Row click navigates to the account detail route (decision 2, route
   * unchanged: /channels/:channel/accounts/:accountId).
   */
  onAccountRowClick(account: IChannelAccount): void {
    console.debug("[ChannelsComponent] fleet row clicked, navigating", {
      accountId: account.id,
      channel: this.channelFilter(),
    });
    this.router
      .navigate(["/channels", this.channelFilter(), "accounts", account.id])
      .catch((error: unknown) => {
        console.error(
          "[ChannelsComponent] navigation to account detail failed",
          { accountId: account.id, error }
        );
      });
  }

  /**
   * Needs-attention action link navigates to the same account detail
   * route (decision 2); issue.id is the account id (see attentionIssues).
   */
  onAttentionActionClick(issue: IAttentionIssue): void {
    console.debug(
      "[ChannelsComponent] needs-attention action clicked, navigating",
      { accountId: issue.id, channel: this.channelFilter() }
    );
    this.router
      .navigate(["/channels", this.channelFilter(), "accounts", issue.id])
      .catch((error: unknown) => {
        console.error(
          "[ChannelsComponent] navigation from needs-attention panel failed",
          { accountId: issue.id, error }
        );
      });
  }

  protected loadAccounts(): void {
    this.loading.set(true);
    this.error.set(null);
    this.channels.listAccounts().subscribe({
      next: (data) => {
        this.accounts.set(data);
        this.loading.set(false);
        console.debug("[ChannelsComponent] accounts loaded", {
          channel: this.channelFilter(),
          count: data.filter((a) => a.channel === this.channelFilter()).length,
        });
      },
      error: (err) => {
        this.error.set(err?.message ?? "Failed to load accounts");
        this.loading.set(false);
        console.error("[ChannelsComponent] failed to load accounts", {
          channel: this.channelFilter(),
          error: err,
        });
      },
    });
  }

  /**
   * Messages 24h (in/out split) - the only fleet-strip metric with a real
   * per-channel data source (T01 finding 11). Reuses the existing
   * getUsageTotals endpoint scoped by channel, no new API endpoint.
   */
  protected loadUsageTotals(): void {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    this.channels
      .getUsageTotals({
        from: from.toISOString(),
        to: to.toISOString(),
        channel: this.channelFilter(),
      })
      .subscribe({
        next: (result) => {
          const inCount = result.items
            .filter((i) => i.direction === "ingress")
            .reduce((sum, i) => sum + i.events, 0);
          const outCount = result.items
            .filter((i) => i.direction === "egress")
            .reduce((sum, i) => sum + i.events, 0);
          this.messagesIn24h.set(inCount);
          this.messagesOut24h.set(outCount);
          console.debug("[ChannelsComponent] usage totals loaded", {
            channel: this.channelFilter(),
            inCount,
            outCount,
          });
        },
        error: (err) => {
          this.messagesIn24h.set(null);
          this.messagesOut24h.set(null);
          console.error("[ChannelsComponent] failed to load usage totals", {
            channel: this.channelFilter(),
            error: err,
          });
        },
      });
  }
}
