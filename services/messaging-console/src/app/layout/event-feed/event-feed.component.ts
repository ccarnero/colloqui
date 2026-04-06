import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { DatePipe, JsonPipe } from "@angular/common";
import { Subscription } from "rxjs";
import { LucideAngularModule, Radio, Zap } from "lucide-angular";
import {
  EventStreamService,
  type IChannelStreamEvent,
} from "../../core/services/event-stream.service";

interface IFeedEntry {
  kind: string;
  channel: string;
  timestamp: Date;
  summary: string;
  raw: IChannelStreamEvent;
}

const MAX_FEED_ENTRIES = 100;

@Component({
  selector: "app-event-feed",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, JsonPipe, LucideAngularModule],
  template: `
    <div class="feed-header">
      <lucide-icon [img]="Radio" [size]="14" />
      <span>Live Events</span>
      <span class="feed-count">{{ entries().length }}</span>
    </div>
    <div class="feed-body">
      @if (entries().length === 0) {
        <div class="feed-empty">
          <lucide-icon [img]="Zap" [size]="20" />
          <span>Waiting for events...</span>
          <span class="feed-hint">
            Inbound messages and status updates will appear here
            in real-time.
          </span>
        </div>
      }
      @for (entry of entries(); track entry.timestamp) {
        <div
          class="feed-item"
          [class.feed-item--expanded]="selectedId() === entry.raw.id"
          (click)="toggle(entry.raw.id)">
          <div class="feed-dot"
               [class.dot-received]="entry.kind === 'received'"
               [class.dot-sent]="entry.kind === 'sent'"
               [class.dot-status]="
                 entry.kind !== 'received' && entry.kind !== 'sent'
               ">
          </div>
          <div class="feed-content">
            <span class="feed-type">
              {{ entry.channel }} &middot; {{ entry.kind }}
            </span>
            <span class="feed-summary">{{ entry.summary }}</span>
            <span class="feed-time">
              {{ entry.timestamp | date: "HH:mm:ss" }}
            </span>
            @if (selectedId() === entry.raw.id) {
              <pre class="feed-detail">{{ entry.raw | json }}</pre>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg);
    }
    .feed-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text3);
    }
    .feed-count {
      margin-left: auto;
      background: var(--bg3);
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 11px;
    }
    .feed-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .feed-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px 20px;
      color: var(--text3);
      text-align: center;
      font-size: 13px;
    }
    .feed-hint {
      font-size: 11px;
      color: var(--text3);
      max-width: 200px;
      line-height: 1.4;
    }
    .feed-item {
      display: flex;
      gap: 10px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      transition: background 0.1s;
      cursor: pointer;
    }
    .feed-item:hover {
      background: var(--bg2);
    }
    .feed-item--expanded {
      background: var(--bg2);
    }
    .feed-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 4px;
      background: var(--text3);
    }
    .dot-received {
      background: var(--green);
    }
    .dot-sent {
      background: var(--cyan);
    }
    .dot-status {
      background: var(--text3);
    }
    .feed-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .feed-type {
      font-size: 11px;
      font-weight: 600;
      color: var(--text2);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .feed-summary {
      font-size: 12px;
      color: var(--text3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .feed-time {
      font-size: 10px;
      color: var(--text3);
    }
    .feed-detail {
      margin: 6px 0 0;
      padding: 8px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 10px;
      line-height: 1.5;
      color: var(--text2);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
  `,
})
export class EventFeedComponent implements OnInit, OnDestroy {
  protected readonly Radio = Radio;
  protected readonly Zap = Zap;

  private readonly streamService = inject(EventStreamService);
  private sub: Subscription | null = null;

  readonly entries = signal<IFeedEntry[]>([]);
  readonly selectedId = signal<string | null>(null);

  ngOnInit(): void {
    this.sub = this.streamService.connect().subscribe((event) => {
      this.addEntry(event);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.streamService.disconnect();
  }

  toggle(id: string): void {
    this.selectedId.update((prev) => (prev === id ? null : id));
  }

  private addEntry(event: IChannelStreamEvent): void {
    const entry: IFeedEntry = {
      kind: event.kind,
      channel: event.channel,
      timestamp: new Date(),
      summary: this.buildSummary(event),
      raw: event,
    };
    this.entries.update((prev) => {
      const next = [entry, ...prev];
      if (next.length > MAX_FEED_ENTRIES) next.length = MAX_FEED_ENTRIES;
      return next;
    });
  }

  private buildSummary(event: IChannelStreamEvent): string {
    const { data, kind } = event;
    if (!data) return event.id;

    if (kind === "received") {
      const text = data.text ?? "";
      if (data.from && text) return `${data.from}: ${text}`;
      if (data.from) return `From ${data.from}`;
    }

    if (kind === "sent") {
      const text = data.text ?? "";
      if (data.to && text) return `To ${data.to}: ${text}`;
      if (data.to) return `To ${data.to}`;
    }

    if (data.type) return `${data.type} message`;
    return event.id;
  }
}
