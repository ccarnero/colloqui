import { Component, inject, signal, type OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { HttpAdapterDialogComponent } from "../../../../shared/components/http-adapter-dialog/http-adapter-dialog.component";
import {
  type HttpAdapter,
  type HttpAdapterDialogData,
} from "../../../../shared/models/http-adapter.model";
import { StatusBadgeComponent } from "../../../../shared/components/status-badge/status-badge.component";
import {
  HttpAdapterService,
  type AdapterDto,
  type CreateAdapterPayload,
  type UpdateAdapterPayload,
} from "../../../../core/services/http-adapter.service";

interface InternalSourceRow {
  id: string;
  adapter: HttpAdapter;
  status: string;
  latency: string;
}

function toRow(dto: AdapterDto): InternalSourceRow {
  return {
    id: dto.id,
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
    latency: "—",
  };
}

function toCreatePayload(adapter: HttpAdapter): CreateAdapterPayload {
  return {
    name: adapter.name,
    context: "internal",
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
  selector: "app-internal-sources",
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
        <div class="ws-title">Internal Sources</div>
        <div class="ws-subtitle">
          HTTP adapters for services inside the cluster
        </div>
      </div>
      <div class="ws-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="openCreate()"
        >
          + Add Internal Source
        </button>
      </div>
    </div>

    @if (loading()) {
      <div style="display:flex;justify-content:center;padding:2rem">
        <mat-spinner diameter="36" />
      </div>
    } @else {
      <div class="table-wrap">
        <table mat-table [dataSource]="sources()">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let r">{{ r.adapter.name }}</td>
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
          <ng-container matColumnDef="healthCheck">
            <th mat-header-cell *matHeaderCellDef>Health Check</th>
            <td mat-cell *matCellDef="let r" style="font-family:monospace">
              {{ r.adapter.healthCheckPath }}
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
})
export class InternalSourcesComponent implements OnInit {
  private readonly dialog = inject(MatDialog);
  private readonly adapterService = inject(HttpAdapterService);

  readonly cols = [
    "name",
    "baseUrl",
    "auth",
    "endpoints",
    "status",
    "healthCheck",
    "actions",
  ] as const;

  readonly sources = signal<InternalSourceRow[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.loadSources();
  }

  openCreate(): void {
    const data: HttpAdapterDialogData = {
      mode: "create",
      context: "internal",
    };
    this.dialog
      .open(HttpAdapterDialogComponent, {
        data,
        width: "860px",
        maxWidth: "95vw",
        panelClass: "app-dialog-panel",
      })
      .afterClosed()
      .subscribe((result: HttpAdapter | undefined) => {
        if (!result) return;
        this.adapterService
          .create(toCreatePayload(result))
          .subscribe((dto) => {
            this.sources.update((rows) => [...rows, toRow(dto)]);
          });
      });
  }

  openEdit(index: number): void {
    const row = this.sources()[index];
    const data: HttpAdapterDialogData = {
      mode: "edit",
      context: "internal",
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
      .subscribe((result: HttpAdapter | undefined) => {
        if (!result) return;
        this.adapterService
          .update(row.id, toUpdatePayload(result))
          .subscribe((dto) => {
            this.sources.update((rows) =>
              rows.map((r, i) => (i === index ? toRow(dto) : r)),
            );
          });
      });
  }

  remove(index: number): void {
    const row = this.sources()[index];
    this.adapterService.remove(row.id).subscribe(() => {
      this.sources.update((rows) => rows.filter((_, i) => i !== index));
    });
  }

  private loadSources(): void {
    this.adapterService.list("internal").subscribe({
      next: (dtos) => {
        this.sources.set(dtos.map(toRow));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
}
