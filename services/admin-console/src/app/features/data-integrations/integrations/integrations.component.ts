import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

interface IIntegrationRow {
  name: string;
  category: string;
  status: string;
  lastSync: string;
  connected: boolean;
}

@Component({
  selector: "app-integrations",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Integrations</div>
        <div class="ws-subtitle">Connect external systems and sync data</div>
      </div>
      <div class="ws-actions">
        <button type="button" class="btn btn-primary btn-sm">+ Add Integration</button>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="integrations()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let r">{{ r.name }}</td>
        </ng-container>
        <ng-container matColumnDef="category">
          <th mat-header-cell *matHeaderCellDef>Category</th>
          <td mat-cell *matCellDef="let r">
            <span class="badge badge-blue">{{ r.category }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let r">
            <app-status-badge [status]="r.status" />
          </td>
        </ng-container>
        <ng-container matColumnDef="lastSync">
          <th mat-header-cell *matHeaderCellDef>Last sync</th>
          <td mat-cell *matCellDef="let r" style="font-family:monospace">
            {{ r.lastSync }}
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>Actions</th>
          <td mat-cell *matCellDef="let r; let i = index">
            @if (r.connected) {
              <button
                type="button"
                mat-icon-button
                aria-label="Disconnect"
                (click)="disconnect(i)"
              >
                <mat-icon>link_off</mat-icon>
              </button>
            } @else {
              <button
                type="button"
                mat-icon-button
                aria-label="Connect"
                (click)="connect(i)"
              >
                <mat-icon>link</mat-icon>
              </button>
            }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class IntegrationsComponent {
  readonly cols = [
    "name",
    "category",
    "status",
    "lastSync",
    "actions",
  ] as const;

  readonly integrations = signal<IIntegrationRow[]>([
    {
      name: "Salesforce CRM",
      category: "CRM",
      status: "connected",
      lastSync: "2025-03-20 14:02",
      connected: true,
    },
    {
      name: "Segment",
      category: "Analytics",
      status: "connected",
      lastSync: "2025-03-20 13:58",
      connected: true,
    },
    {
      name: "HubSpot",
      category: "Marketing",
      status: "degraded",
      lastSync: "2025-03-19 09:12",
      connected: true,
    },
    {
      name: "Snowflake",
      category: "Warehouse",
      status: "disconnected",
      lastSync: "—",
      connected: false,
    },
    {
      name: "Zendesk",
      category: "Support",
      status: "connected",
      lastSync: "2025-03-20 12:40",
      connected: true,
    },
  ]);

  connect(index: number): void {
    this.integrations.update((rows) =>
      rows.map((r, i) =>
        i === index ? { ...r, connected: true, status: "connected" } : r,
      ),
    );
  }

  disconnect(index: number): void {
    this.integrations.update((rows) =>
      rows.map((r, i) =>
        i === index ? { ...r, connected: false, status: "disconnected" } : r,
      ),
    );
  }
}
