import type { HttpTransport } from '../transport';
import type { AuditQuery, AuditEvent, AuditQueryResult } from '../types';

export class AuditClient {
  constructor(private readonly transport: HttpTransport) {}

  async query(filters?: AuditQuery): Promise<AuditQueryResult> {
    return this.transport.get<AuditQueryResult>('/audit/events', filters as Record<string, string | undefined>);
  }

  async get(id: string): Promise<AuditEvent> {
    return this.transport.get<AuditEvent>(`/audit/events/${encodeURIComponent(id)}`);
  }
}
