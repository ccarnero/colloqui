import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { concatMap, from, of, switchMap, toArray } from "rxjs";
import { HttpAdapterDialogComponent } from "../../../shared/components/http-adapter-dialog/http-adapter-dialog.component";
import {
  type IHttpAdapter,
  type IHttpAdapterCacheStrategy,
  type IHttpAdapterContext,
  type IHttpAdapterDialogData,
  type IHttpAdapterDialogResult,
} from "../../../shared/models/http-adapter.model";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";
import {
  HttpAdapterService,
  type IAdapterDto,
  type ICreateAdapterPayload,
  type IUpdateAdapterPayload,
} from "../../../core/services/http-adapter.service";

interface IConnectorRow {
  id: string;
  context: IHttpAdapterContext;
  tags: string[];
  adapter: IHttpAdapter;
  status: string;
}

function toCacheStrategy(
  cache?: IAdapterDto["defaultCache"],
): IHttpAdapterCacheStrategy | undefined {
  if (!cache) {
    return undefined;
  }

  return {
    enabled: cache.enabled,
    ttlSeconds: cache.ttlSeconds,
    methods: cache.methods as IHttpAdapterCacheStrategy["methods"],
    keyBody: cache.keyBody,
    keyHeaders: cache.keyHeaders,
    keyQueryParams: cache.keyQueryParams,
  };
}

function toRow(dto: IAdapterDto): IConnectorRow {
  return {
    id: dto.id,
    context: dto.context as IHttpAdapterContext,
    tags: dto.tags ?? [],
    adapter: {
      name: dto.name,
      baseUrl: dto.baseUrl,
      auth: {
        type: dto.authType as IHttpAdapter["auth"]["type"],
        ...(dto.authConfig as Record<string, unknown>),
      },
      headers: dto.headers,
      defaultCache: toCacheStrategy(dto.defaultCache),
      endpoints: dto.endpoints.map((ep) => ({
        id: ep.id,
        label: ep.label,
        method: ep.method as IHttpAdapter["endpoints"][number]["method"],
        path: ep.path,
        cache: toCacheStrategy(ep.cache),
      })),
      timeoutMs: dto.timeoutMs,
      maxRetries: dto.maxRetries,
      retryBackoffMs: dto.retryBackoffMs,
      healthCheckPath: dto.healthCheckPath,
      tags: dto.tags ?? [],
      isEncrypted: dto.isEncrypted ?? false,
    },
    status: dto.status,
  };
}

function toCreatePayload(
  adapter: IHttpAdapter,
  context: IHttpAdapterContext,
): ICreateAdapterPayload {
  return {
    name: adapter.name,
    context,
    baseUrl: adapter.baseUrl,
    authType: adapter.auth.type,
    authConfig: adapter.auth as unknown as Record<string, unknown>,
    headers: adapter.headers,
    defaultCache: adapter.defaultCache,
    timeoutMs: adapter.timeoutMs,
    maxRetries: adapter.maxRetries,
    retryBackoffMs: adapter.retryBackoffMs,
    healthCheckPath: adapter.healthCheckPath,
    tags: adapter.tags,
    endpoints: adapter.endpoints.map((ep) => ({
      label: ep.label,
      method: ep.method,
      path: ep.path,
      cache: ep.cache,
    })),
  };
}

function toUpdatePayload(adapter: IHttpAdapter): IUpdateAdapterPayload {
  return {
    name: adapter.name,
    baseUrl: adapter.baseUrl,
    authType: adapter.auth.type,
    authConfig: adapter.auth as unknown as Record<string, unknown>,
    headers: adapter.headers,
    defaultCache: adapter.defaultCache ?? null,
    timeoutMs: adapter.timeoutMs,
    maxRetries: adapter.maxRetries,
    retryBackoffMs: adapter.retryBackoffMs,
    healthCheckPath: adapter.healthCheckPath,
    tags: adapter.tags,
  };
}

@Component({
  selector: "app-connectors",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTableModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Connectors</div>
        <div class="ws-subtitle">
          HTTP adapters for your services
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

    <div class="filter-bar">
      <mat-chip-listbox
        [value]="activeTag()"
        (change)="onTagFilter($event.value)"
        class="tag-filter"
      >
        <mat-chip-option value="">All</mat-chip-option>
        @for (tag of availableTags(); track tag) {
          <mat-chip-option [value]="tag">{{ tag }}</mat-chip-option>
        }
      </mat-chip-listbox>
    </div>

    @if (loading()) {
      <div style="display:flex;justify-content:center;padding:2rem">
        <mat-spinner diameter="36" />
      </div>
    } @else {
      <div class="table-wrap">
        <table mat-table [dataSource]="filteredConnectors()">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let r">
              <div class="name-cell">
                <mat-icon class="name-icon">http</mat-icon>
                <span>{{ r.adapter.name }}</span>
              </div>
            </td>
          </ng-container>
          <ng-container matColumnDef="tags">
            <th mat-header-cell *matHeaderCellDef>Tags</th>
            <td mat-cell *matCellDef="let r">
              @for (tag of r.tags; track tag) {
                <span class="badge badge-violet">{{ tag }}</span>
              }
              @if (r.tags.length === 0) {
                <span class="badge badge-slate">—</span>
              }
            </td>
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
    .badge-violet {
      background: rgba(139, 92, 246, 0.15);
      color: #8b5cf6;
    }
    .badge-slate {
      background: rgba(148, 163, 184, 0.15);
      color: #94a3b8;
    }
    .filter-bar {
      padding: 0 0 12px;
    }
    .tag-filter {
      font-size: 12px;
    }
    .name-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .name-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--text3);
    }
  `,
})
export class ConnectorsComponent implements OnInit {
  private readonly dialog = inject(MatDialog);
  private readonly adapterService = inject(HttpAdapterService);

  readonly cols = [
    "name",
    "tags",
    "scope",
    "baseUrl",
    "auth",
    "endpoints",
    "status",
    "actions",
  ] as const;

  readonly connectors = signal<IConnectorRow[]>([]);
  readonly loading = signal(true);
  readonly activeTag = signal<string>("");

  readonly availableTags = computed(() => {
    const all = this.connectors().flatMap((r) => r.tags);
    return [...new Set(all)].sort();
  });

  readonly filteredConnectors = computed(() => {
    const tag = this.activeTag();
    if (!tag) return this.connectors();
    return this.connectors().filter((r) => r.tags.includes(tag));
  });

  ngOnInit(): void {
    this.loadConnectors();
  }

  onTagFilter(tag: string): void {
    this.activeTag.set(tag ?? "");
  }

  openCreate(): void {
    const data: IHttpAdapterDialogData = { mode: "create" };
    this.dialog
      .open(HttpAdapterDialogComponent, {
        data,
        width: "860px",
        maxWidth: "95vw",
        panelClass: "app-dialog-panel",
      })
      .afterClosed()
      .subscribe((result?: IHttpAdapterDialogResult) => {
        if (!result) return;
        this.adapterService
          .create(toCreatePayload(result.adapter, result.context))
          .subscribe((dto) => {
            this.connectors.update((rows) => [...rows, toRow(dto)]);
          });
      });
  }

  openEdit(index: number): void {
    const row = this.filteredConnectors()[index];
    const data: IHttpAdapterDialogData = {
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
      .subscribe((result?: IHttpAdapterDialogResult) => {
        if (!result) return;
        const endpointOperations = this.buildEndpointOperations(
          row.id,
          row.adapter,
          result.adapter,
        );
        const endpointSync$ =
          endpointOperations.length === 0
            ? of([])
            : from(endpointOperations).pipe(
                concatMap((operation) => operation),
                toArray(),
              );

        this.adapterService
          .update(row.id, toUpdatePayload(result.adapter))
          .pipe(
            switchMap(() => endpointSync$),
            switchMap(() => this.adapterService.get(row.id)),
          )
          .subscribe((dto) => {
            this.connectors.update((rows) =>
              rows.map((r) => (r.id === row.id ? toRow(dto) : r)),
            );
          });
      });
  }

  remove(index: number): void {
    const row = this.filteredConnectors()[index];
    this.adapterService.remove(row.id).subscribe(() => {
      this.connectors.update((rows) => rows.filter((r) => r.id !== row.id));
    });
  }

  private loadConnectors(): void {
    this.loading.set(true);
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

  private buildEndpointOperations(
    adapterId: string,
    current: IHttpAdapter,
    next: IHttpAdapter,
  ) {
    const currentById = new Map(
      current.endpoints
        .filter((endpoint) => endpoint.id)
        .map((endpoint) => [endpoint.id!, endpoint]),
    );
    const nextById = new Map(
      next.endpoints
        .filter((endpoint) => endpoint.id)
        .map((endpoint) => [endpoint.id!, endpoint]),
    );
    const operations = [];

    for (const endpointId of currentById.keys()) {
      if (!nextById.has(endpointId)) {
        operations.push(this.adapterService.removeEndpoint(adapterId, endpointId));
      }
    }

    for (const [endpointId, endpoint] of nextById.entries()) {
      operations.push(
        this.adapterService.updateEndpoint(adapterId, endpointId, {
          label: endpoint.label,
          method: endpoint.method,
          path: endpoint.path,
          cache: endpoint.cache ?? null,
        }),
      );
    }

    for (let i = 0; i < next.endpoints.length; i++) {
      const endpoint = next.endpoints[i]!;
      if (!endpoint.id) {
        operations.push(
          this.adapterService.addEndpoint(adapterId, {
            label: endpoint.label,
            method: endpoint.method,
            path: endpoint.path,
            cache: endpoint.cache,
          }),
        );
      }
    }

    return operations;
  }
}
