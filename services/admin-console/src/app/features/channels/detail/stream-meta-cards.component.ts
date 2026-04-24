import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  input,
} from "@angular/core";
import { DatePipe, DecimalPipe, UpperCasePipe } from "@angular/common";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import type { IStreamSummary } from "../../../core/models/channel-streams.model";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

@Component({
  selector: "app-stream-meta-cards",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    UpperCasePipe,
    MatIconModule,
    MatButtonModule,
  ],
  template: `
    <div class="stream-grid">
      @for (s of streams(); track s.name) {
        <div class="stream-card">
          <div class="stream-card__header">
            <div class="stream-card__title">
              <span
                class="badge"
                [class.badge-blue]="s.kind === 'ingress'"
                [class.badge-red]="s.kind === 'dlq'"
              >
                {{ s.kind | uppercase }}
              </span>
              <strong>{{ s.name }}</strong>
            </div>
            <button
              mat-stroked-button
              type="button"
              color="primary"
              (click)="inspect.emit(s.kind)"
            >
              <mat-icon>search</mat-icon>
              Inspect
            </button>
          </div>

          <div class="stream-card__stats">
            <div class="stat">
              <div class="stat-label">Messages</div>
              <div class="stat-value">{{ s.messages | number }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Bytes</div>
              <div class="stat-value">{{ formatBytes(s.bytes) }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">First seq</div>
              <div class="stat-value">{{ s.firstSeq | number }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Last seq</div>
              <div class="stat-value">{{ s.lastSeq | number }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Consumers</div>
              <div class="stat-value">{{ s.consumerCount | number }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Last event</div>
              <div class="stat-value small">
                @if (s.lastTs) {
                  {{ s.lastTs | date: "medium" }}
                } @else {
                  —
                }
              </div>
            </div>
          </div>
        </div>
      } @empty {
        <div class="empty">No JetStream streams provisioned.</div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .stream-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 16px;
    }
    .stream-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .stream-card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .stream-card__title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: monospace;
      color: var(--text);
    }
    .stream-card__stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .stat-label {
      font-size: 11px;
      color: var(--text3);
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      margin-top: 2px;
    }
    .stat-value.small {
      font-size: 13px;
      font-weight: 500;
    }
    .badge-blue {
      background: rgba(79, 126, 248, 0.15);
      color: #4f7ef8;
    }
    .badge-red {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .empty {
      padding: 24px;
      text-align: center;
      color: var(--text3);
      background: var(--bg2);
      border: 1px dashed var(--border);
      border-radius: 8px;
    }
  `,
})
export class StreamMetaCardsComponent {
  readonly streams = input<ReadonlyArray<IStreamSummary>>([]);
  @Output() readonly inspect = new EventEmitter<"ingress" | "dlq">();

  readonly formatBytes = formatBytes;
}
