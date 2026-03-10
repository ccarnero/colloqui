import type { YoizenClientOptions } from './types';
import { HttpTransport } from './transport';
import { AuthClient } from './clients/auth';
import { EventsClient } from './clients/events';
import { WorkflowsClient } from './clients/workflows';
import { SchedulesClient } from './clients/schedules';
import { RegistryClient } from './clients/registry';
import { CacheClient } from './clients/cache';
import { AuditClient } from './clients/audit';

export class YoizenClient {
  private readonly transport: HttpTransport;

  private _auth: AuthClient | null = null;
  private _events: EventsClient | null = null;
  private _workflows: WorkflowsClient | null = null;
  private _schedules: SchedulesClient | null = null;
  private _registry: RegistryClient | null = null;
  private _cache: CacheClient | null = null;
  private _audit: AuditClient | null = null;

  constructor(opts: YoizenClientOptions) {
    this.transport = new HttpTransport(opts);
  }

  get auth(): AuthClient {
    return (this._auth ??= new AuthClient(this.transport));
  }

  get events(): EventsClient {
    return (this._events ??= new EventsClient(this.transport));
  }

  get workflows(): WorkflowsClient {
    return (this._workflows ??= new WorkflowsClient(this.transport));
  }

  get schedules(): SchedulesClient {
    return (this._schedules ??= new SchedulesClient(this.transport));
  }

  get registry(): RegistryClient {
    return (this._registry ??= new RegistryClient(this.transport));
  }

  get cache(): CacheClient {
    return (this._cache ??= new CacheClient(this.transport));
  }

  get audit(): AuditClient {
    return (this._audit ??= new AuditClient(this.transport));
  }
}
