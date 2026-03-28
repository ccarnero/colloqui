import { Injectable, inject, OnDestroy } from "@angular/core";
import { Observable, Subject } from "rxjs";
import { environment } from "../../../environments/environment";
import { AuthService } from "./auth.service";

export interface IChannelStreamEvent {
  id: string;
  type: string;
  subject: string;
  channel: string;
  kind: string;
  tenantId: string;
  provider: string;
  time: string;
  data: {
    messageId: string;
    from: string;
    timestamp: string;
    type: string;
    text?: string;
    media?: { mimeType: string; id?: string; caption?: string };
    to?: string;
    providerMessageId?: string;
    accountId: string;
  };
}

const MIN_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;

@Injectable({ providedIn: "root" })
export class EventStreamService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly events$ = new Subject<IChannelStreamEvent>();
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = MIN_RECONNECT_MS;
  private stopped = false;

  /**
   * Opens the SSE connection to the channel stream (idempotent).
   * Subscribers receive real-time channel messaging events.
   */
  connect(): Observable<IChannelStreamEvent> {
    if (!this.source) {
      this.stopped = false;
      this.open();
    }
    return this.events$.asObservable();
  }

  disconnect(): void {
    this.stopped = true;
    this.closeSource();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.events$.complete();
  }

  private open(): void {
    if (this.stopped) return;

    const token = this.auth.token();
    if (!token) return;

    const tenant = this.auth.tenantId();
    const params = new URLSearchParams({ token });
    if (tenant) params.set("tenant", tenant);
    const url = `${environment.apiUrl}/channels/stream?${params.toString()}`;

    try {
      this.source = new EventSource(url);

      this.source.onmessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(
            event.data as string,
          ) as IChannelStreamEvent;
          this.backoffMs = MIN_RECONNECT_MS;
          this.events$.next(parsed);
        } catch {
          /* non-JSON payloads are silently dropped */
        }
      };

      this.source.onerror = () => {
        this.closeSource();
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private closeSource(): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_RECONNECT_MS);
  }
}
