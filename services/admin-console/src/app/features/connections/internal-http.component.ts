import { HttpClient } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { forkJoin } from "rxjs";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { environment } from "../../../environments/environment";
import { RegistryService } from "../../core/services/registry.service";
import type {
  IRegisteredService,
  IServiceRoute,
} from "../../core/models/registry.model";

interface IInternalRouteRow {
  serviceId: string;
  serviceName: string;
  serviceStatus: string;
  routeId: string;
  pathPrefix: string;
  methods: string[];
  isPublic: boolean;
}

const REGISTRY_BASE = `${environment.apiUrl}/registry/services`;

/**
 * Internal HTTP — connectors of type "service inside the tenant network".
 *
 * NOT CURRENTLY ROUTED. The Internal/External split was collapsed in
 * this version; /connections/http maps directly to ConnectorsComponent.
 * This file is preserved (registry-service wiring intact) for the v2
 * pass that re-introduces the split. Re-add to app.routes.ts at
 * /connections/http/internal (with sub-tabs in the HTTP shell) to
 * bring it back.
 *
 * Backed by registry-service: lists every registered service and
 * flattens its routes into a single table. Each row is one route
 * exposed by one internal service.
 *
 * Routes are nested under services in the API, so we fan out to fetch
 * routes per service then flatten. A future flat-route endpoint would
 * let us replace the fan-out with a single GET.
 */
@Component({
  selector: "app-internal-http",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent],
  template: `
    <app-page-header
      title="Internal HTTP"
      subtitle="Conectores hacia servicios internos del tenant"
    >
      <div slot="actions">
        <button class="btn" type="button" (click)="reload()">Refresh</button>
      </div>
    </app-page-header>

    @if (loading()) {
      <p class="empty">Loading…</p>
    }

    @if (!loading()) {
      <div class="panel">
        <div class="row row-head">
          <span class="c-status">Status</span>
          <span class="c-name">Service · path</span>
          <span class="c-methods">Methods</span>
          <span class="c-vis">Visibility</span>
        </div>
        @for (r of rows(); track r.routeId) {
          <div class="row">
            <span class="c-status" [class]="'rs-' + statusClass(r.serviceStatus)">
              <span class="dot"></span>{{ r.serviceStatus }}
            </span>
            <span class="c-name">
              <span class="svc">{{ r.serviceName }}</span>
              <span class="path">{{ r.pathPrefix }}</span>
            </span>
            <span class="c-methods">
              @for (m of r.methods; track m) {
                <span class="method">{{ m }}</span>
              }
            </span>
            <span class="c-vis">{{ r.isPublic ? 'public' : 'internal' }}</span>
          </div>
        } @empty {
          <p class="empty">No internal HTTP routes registered yet.</p>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      overflow: hidden;
      margin-top: 12px;
    }
    .row {
      display: grid;
      grid-template-columns: 110px 1fr 180px 90px;
      gap: 12px;
      padding: 9px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      align-items: center;
    }
    .row:last-child { border-bottom: none; }
    .row.row-head {
      background: var(--bg3);
      color: var(--text2);
      font-weight: 500;
    }
    .c-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .c-status .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .rs-ok { color: var(--green, #16a34a); }
    .rs-fail { color: var(--red, #ef4444); }
    .rs-other { color: var(--text2); }
    .c-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .svc { color: var(--text-primary); font-weight: 500; }
    .path { color: var(--text2); font-family: var(--font-mono, monospace); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
    .c-methods { display: flex; gap: 4px; flex-wrap: wrap; }
    .method {
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 4px;
      background: var(--bg3);
      color: var(--text2);
      font-family: var(--font-mono, monospace);
    }
    .c-vis {
      font-size: 11px;
      color: var(--text2);
    }
    .empty { padding: 20px; text-align: center; color: var(--text3); font-size: 12px; }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
  `,
})
export class InternalHttpComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly registry = inject(RegistryService);

  readonly rows = signal<IInternalRouteRow[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    // Step 1: list services. Step 2: fan-out per service for routes.
    // Step 3: flatten into one table.
    this.http.get<IRegisteredService[]>(REGISTRY_BASE).subscribe({
      next: (services) => {
        if (!services || services.length === 0) {
          this.rows.set([]);
          this.loading.set(false);
          return;
        }
        forkJoin(
          services.map((s) => this.registry.listRoutes(s.id)),
        ).subscribe({
          next: (routesPerService) => {
            const out: IInternalRouteRow[] = [];
            services.forEach((s, idx) => {
              const routes = (routesPerService[idx] ?? []) as IServiceRoute[];
              for (const r of routes) {
                out.push({
                  serviceId: s.id,
                  serviceName: s.name,
                  serviceStatus: s.status,
                  routeId: r.id,
                  pathPrefix: r.pathPrefix,
                  methods: r.methods,
                  isPublic: r.isPublic,
                });
              }
            });
            this.rows.set(out);
            this.loading.set(false);
          },
          error: () => {
            this.rows.set([]);
            this.loading.set(false);
          },
        });
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  protected statusClass(s: string): "ok" | "fail" | "other" {
    const v = (s ?? "").toLowerCase();
    if (v.includes("ok") || v.includes("ready") || v.includes("running")) return "ok";
    if (v.includes("fail") || v.includes("error") || v.includes("down")) return "fail";
    return "other";
  }
}
