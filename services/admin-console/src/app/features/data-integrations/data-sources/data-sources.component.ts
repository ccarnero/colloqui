import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

interface IDataSourceRow {
  name: string;
  type: string;
  host: string;
  status: string;
  latency: string;
  records: string;
}

@Component({
  selector: "app-data-sources",
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
        <div class="ws-title">Data Sources</div>
        <div class="ws-subtitle">Manage database and storage connections</div>
      </div>
      <div class="ws-actions">
        <button type="button" class="btn btn-primary btn-sm">+ Add Source</button>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="sources()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let s">{{ s.name }}</td>
        </ng-container>
        <ng-container matColumnDef="type">
          <th mat-header-cell *matHeaderCellDef>Type</th>
          <td mat-cell *matCellDef="let s">
            <span class="badge badge-blue">{{ s.type }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="host">
          <th mat-header-cell *matHeaderCellDef>Host</th>
          <td
            mat-cell
            *matCellDef="let s"
            style="font-family:monospace;color:var(--cyan)"
          >
            {{ s.host }}
          </td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let s">
            <app-status-badge [status]="s.status" />
          </td>
        </ng-container>
        <ng-container matColumnDef="latency">
          <th mat-header-cell *matHeaderCellDef>Latency</th>
          <td mat-cell *matCellDef="let s">{{ s.latency }}</td>
        </ng-container>
        <ng-container matColumnDef="records">
          <th mat-header-cell *matHeaderCellDef>Records</th>
          <td mat-cell *matCellDef="let s">{{ s.records }}</td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class DataSourcesComponent {
  readonly cols = [
    "name",
    "type",
    "host",
    "status",
    "latency",
    "records",
  ] as const;

  readonly sources = signal<IDataSourceRow[]>([
    {
      name: "Primary PostgreSQL",
      type: "PostgreSQL",
      host: "db-primary.acme.internal",
      status: "connected",
      latency: "2ms",
      records: "4.2M",
    },
    {
      name: "Analytics Warehouse",
      type: "BigQuery",
      host: "bigquery.googleapis.com",
      status: "connected",
      latency: "45ms",
      records: "120M",
    },
    {
      name: "Redis Cache",
      type: "Redis",
      host: "cache.acme.internal",
      status: "connected",
      latency: "<1ms",
      records: "—",
    },
    {
      name: "S3 Archive",
      type: "S3",
      host: "s3.us-east-1.amazonaws.com",
      status: "connected",
      latency: "80ms",
      records: "—",
    },
    {
      name: "Legacy MySQL",
      type: "MySQL",
      host: "legacy-db.acme.internal",
      status: "degraded",
      latency: "320ms",
      records: "890K",
    },
    {
      name: "Elasticsearch",
      type: "Elasticsearch",
      host: "search.acme.internal",
      status: "connected",
      latency: "12ms",
      records: "8.5M",
    },
  ]);
}
