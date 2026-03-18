import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { tracedFetch } from '@yoizen/observability';

interface RouteEntry {
  id: string;
  tenantId: string;
  serviceName: string;
  knativeName: string;
  namespace: string;
  port: number;
  pathPrefix: string;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
}

interface MatchResult {
  knativeName: string;
  namespace: string;
  port: number;
  pathPrefix: string;
  stripPrefix: boolean;
  isPublic: boolean;
  upstreamPath: string;
}

const POLL_INTERVAL_MS = 15_000;
const FETCH_TIMEOUT_MS = 5_000;

@Injectable()
export class DynamicRouteCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DynamicRouteCacheService.name);
  private readonly routesByTenant = new Map<string, RouteEntry[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly registryUrl: string;

  constructor() {
    this.registryUrl =
      process.env.REGISTRY_SERVICE_URL ??
      'http://registry-service.platform-services.svc.cluster.local';
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  match(tenantId: string, method: string, path: string): MatchResult | null {
    const routes = this.routesByTenant.get(tenantId);
    if (!routes) return null;

    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (!path.startsWith(r.pathPrefix)) continue;
      if (!r.methods.includes(method)) continue;

      const upstreamPath = r.stripPrefix
        ? path.slice(r.pathPrefix.length) || '/'
        : path;

      return {
        knativeName: r.knativeName,
        namespace: r.namespace,
        port: r.port,
        pathPrefix: r.pathPrefix,
        stripPrefix: r.stripPrefix,
        isPublic: r.isPublic,
        upstreamPath,
      };
    }

    return null;
  }

  private async refresh(): Promise<void> {
    try {
      const res = await tracedFetch(`${this.registryUrl}/routes`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Route discovery returned ${res.status}`);
        return;
      }

      const entries: RouteEntry[] = await res.json();
      const grouped = new Map<string, RouteEntry[]>();

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        let list = grouped.get(e.tenantId);
        if (!list) {
          list = [];
          grouped.set(e.tenantId, list);
        }
        list.push(e);
      }

      for (const routes of grouped.values()) {
        routes.sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
      }

      this.routesByTenant.clear();
      for (const [tenant, routes] of grouped) {
        this.routesByTenant.set(tenant, routes);
      }

      this.logger.debug(
        `Refreshed dynamic routes: ${entries.length} routes for ${grouped.size} tenants`,
      );
    } catch (err) {
      this.logger.warn(`Failed to refresh dynamic routes: ${err}`);
    }
  }
}
