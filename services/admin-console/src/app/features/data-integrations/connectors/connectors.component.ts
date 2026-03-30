import { Component, inject, signal, type OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { HttpAdapterDialogComponent } from "../../../shared/components/http-adapter-dialog/http-adapter-dialog.component";
import {
  type HttpAdapter,
  type HttpAdapterContext,
  type HttpAdapterDialogData,
  type HttpAdapterDialogResult,
} from "../../../shared/models/http-adapter.model";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";
import {
  HttpAdapterService,
  type AdapterDto,
  type CreateAdapterPayload,
  type UpdateAdapterPayload,
} from "../../../core/services/http-adapter.service";

interface ConnectorRow {
  id: string;
  context: HttpAdapterContext;
  adapter: HttpAdapter;
  status: string;
}

function toRow(dto: AdapterDto): ConnectorRow {
  return {
    id: dto.id,
    context: dto.context as HttpAdapterContext,
    adapter: {
      name: dto.name,
      baseUrl: dto.baseUrl,
      auth: {
        type: dto.authType as HttpAdapter["auth"]["type"],
        ...(dto.authConfig as Record<string, unknown>),
      },
      headers: dto.headers,
      endpoints: dto.endpoints.map((ep) => ({
        label: ep.label,
        method: ep.method as HttpAdapter["endpoints"][number]["method"],
        path: ep.path,
      })),
      timeoutMs: dto.timeoutMs,
      maxRetries: dto.maxRetries,
      retryBackoffMs: dto.retryBackoffMs,
      healthCheckPath: dto.healthCheckPath,
    },
    status: dto.status,
  };
}

function toCreatePayload(
  adapter: HttpAdapter,
  context: HttpAdapterContext,
): CreateAdapterPayload {
  return {
    name: adapter.name,
    context,
    baseUrl: adapter.baseUrl,
    authType: adapter.auth.type,
    authConfig: adapter.auth as unknown as Record<string, unknown>,
    headers: adapter.headers,
    timeoutMs: adapter.timeoutMs,
    maxRetries: adapter.maxRetries,
    retryBackoffMs: adapter.retryBackoffMs,
    healthCheckPath: adapter.healthCheckPath,
    endpoints: adapter.endpoints.map((ep) => ({
      label: ep.label,
      method: ep.method,
      path: ep.path,
    })),
  };
}

function toUpdatePayload(adapter: HttpAdapter): UpdateAdapterPayload {
  return {
    name: adapter.name,
    baseUrl: adapter.baseUrl,
    authType: adapter.auth.type,
    authConfig: adapter.auth as unknown as Record<string, unknown>,
    headers: adapter.headers,
    timeoutMs: adapter.timeoutMs,
    maxRetries: adapter.maxRetries,
    retryBackoffMs: adapter.retryBackoffMs,
    healthCheckPath: adapter.healthCheckPath,
  };
}

@Component({
  selector: "app-connectors",
  standalone: true,
  imports: [
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Connectors</div>
        <div class="ws-subtitle">
          HTTP adapters for internal and external services
        </div>
      </div>
      <div class="ws-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="openCreate()"
        >
          + Add Connector
        </button>
      </div>
    </div>

    @if (loading()) {
      <div style="display:flex;justify-content:center;padding:2rem">
        <mat-spinner diameter="36" />
      </div>
    } @else {
      <div class="table-wrap">
        <table mat-table [dataSource]="connectors()">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let r">{{ r.adapter.name }}</td>
          </ng-container>
          <ng-container matColumnDef="scope">
            <th mat-header-cell *matHeaderCellDef>Scope</th>
            <td mat-cell *matCellDef="let r">
              <span
                class="badge"
                [class.badge-cyan]="r.context === 'internal'"
                [class.badge-orange]="r.context === 'external'"
              >
                {{ r.context }}
              </span>
            </td>
          </ng-container>
          <ng-container matColumnDef="baseUrl">
            <th mat-header-cell *matHeaderCellDef>Base URL</th>
            <td
              mat-cell
              *matCellDef="let r"
              style="font-family:monospace;color:var(--cyan)"
            >
              {{ r.adapter.baseUrl }}
            </td>
          </ng-container>
          <ng-container matColumnDef="auth">
            <th mat-header-cell *matHeaderCellDef>Auth</th>
            <td mat-cell *matCellDef="let r">
              <span class="badge badge-blue">{{ r.adapter.auth.type }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let r">
              <app-status-badge [status]="r.status" />
            </td>
          </ng-container>
          <ng-container matColumnDef="endpoints">
            <th mat-header-cell *matHeaderCellDef>Endpoints</th>
            <td mat-cell *matCellDef="let r">
              <span class="badge badge-purple">
                {{ r.adapter.endpoints.length }}
              </span>
            </td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let r; let i = index">
              <button
                type="button"
                mat-icon-button
                aria-label="Edit"
                (click)="openEdit(i)"
              >
                <mat-icon>edit</mat-icon>
              </button>
              <button
                type="button"
                mat-icon-button
                aria-label="Delete"
                (click)="remove(i)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="cols"></tr>
          <tr mat-row *matRowDef="let row; columns: cols"></tr>
        </table>
      </div>
    }
  `,
  styles: `
    .badge-cyan {
      background: rgba(6, 182, 212, 0.15);
      color: #06b6d4;
    }
    .badge-orange {
      background: rgba(249, 115, 22, 0.15);
      color: #f97316;
    }
  `,
})
export class ConnectorsComponent implements OnInit {
  private readonly dialog = inject(MatDialog);
  private readonly adapterService = inject(HttpAdapterService);

  readonly cols = [
    "name",
    "scope",
    "baseUrl",
    "auth",
    "endpoints",
    "status",
    "actions",
  ] as const;

  readonly connectors = signal<ConnectorRow[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.loadConnectors();
  }

  openCreate(): void {
    const data: HttpAdapterDialogData = { mode: "create" };
    this.dialog
      .open(HttpAdapterDialogComponent, {
        data,
        width: "860px",
        maxWidth: "95vw",
        panelClass: "app-dialog-panel",
      })
      .afterClosed()
      .subscribe((result?: HttpAdapterDialogResult) => {
        if (!result) return;
        this.adapterService
          .create(toCreatePayload(result.adapter, result.context))
          .subscribe((dto) => {
            this.connectors.update((rows) => [...rows, toRow(dto)]);
          });
      });
  }

  openEdit(index: number): void {
    const row = this.connectors()[index];
    const data: HttpAdapterDialogData = {
      mode: "edit",
      context: row.context,
      adapter: row.adapter,
    };
    this.dialog
      .open(HttpAdapterDialogComponent, {
        data,
        width: "860px",
        maxWidth: "95vw",
        panelClass: "app-dialog-panel",
      })
      .afterClosed()
      .subscribe((result?: HttpAdapterDialogResult) => {
        if (!result) return;
        this.adapterService
          .update(row.id, toUpdatePayload(result.adapter))
          .subscribe((dto) => {
            this.connectors.update((rows) =>
              rows.map((r, i) => (i === index ? toRow(dto) : r)),
            );
          });
      });
  }

  remove(index: number): void {
    const row = this.connectors()[index];
    this.adapterService.remove(row.id).subscribe(() => {
      this.connectors.update((rows) => rows.filter((_, i) => i !== index));
    });
  }

  private loadConnectors(): void {
    this.adapterService.list().subscribe({
      next: (dtos) => {
        this.connectors.set(dtos.map(toRow));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
}
