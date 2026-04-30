import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-webhooks",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Webhooks</div>
        <div class="ws-subtitle">
          Deliver events to your endpoints with retries and signatures
        </div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm" type="button">
          + Add webhook
        </button>
      </div>
    </div>

    <div class="section-card">
      <table mat-table [dataSource]="rows">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let r">{{ r.name }}</td>
        </ng-container>
        <ng-container matColumnDef="url">
          <th mat-header-cell *matHeaderCellDef>URL</th>
          <td mat-cell *matCellDef="let r">
            <span class="mono-url">{{ r.url }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="events">
          <th mat-header-cell *matHeaderCellDef>Events</th>
          <td mat-cell *matCellDef="let r">
            <span class="event-tags">
              @for (ev of r.events; track ev) {
                <span class="badge badge-tag">{{ ev }}</span>
              }
            </span>
          </td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let r">
            <app-status-badge [status]="r.status" />
          </td>
        </ng-container>
        <ng-container matColumnDef="lastDelivery">
          <th mat-header-cell *matHeaderCellDef>Last delivery</th>
          <td mat-cell *matCellDef="let r">{{ r.lastDelivery }}</td>
        </ng-container>
        <ng-container matColumnDef="successRate">
          <th mat-header-cell *matHeaderCellDef>Success rate</th>
          <td mat-cell *matCellDef="let r">{{ r.successRate }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>Actions</th>
          <td mat-cell *matCellDef="let r">
            <button
              mat-icon-button
              type="button"
              aria-label="Edit webhook"
              class="icon-btn"
            >
              <mat-icon>edit</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              aria-label="Test webhook"
              class="icon-btn"
            >
              <mat-icon>play_arrow</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </div>
  `,
  styles: `
    .mono-url {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        monospace;
      font-size: 12px;
      color: var(--accent2, #22d3ee);
      word-break: break-all;
    }
    .event-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .badge-tag {
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--bg3);
      border: 1px solid var(--border);
      color: var(--text2);
    }
    .icon-btn {
      color: var(--text3);
    }
  `,
})
export class WebhooksComponent {
  readonly columns = [
    "name",
    "url",
    "events",
    "status",
    "lastDelivery",
    "successRate",
    "actions",
  ] as const;

  readonly rows = [
    {
      name: "Primary ingest",
      url: "https://hooks.acme.example.com/v1/events/primary",
      events: ["user.created", "user.updated"],
      status: "active",
      lastDelivery: "2 min ago",
      successRate: "99.2%",
    },
    {
      name: "Billing sync",
      url: "https://api.billing.partner.net/webhooks/acme",
      events: ["invoice.paid", "invoice.failed"],
      status: "active",
      lastDelivery: "1 hr ago",
      successRate: "100%",
    },
    {
      name: "Legacy CRM",
      url: "https://crm.internal.corp/hooks/incoming",
      events: ["*"],
      status: "paused",
      lastDelivery: "3 days ago",
      successRate: "87.4%",
    },
  ];
}
