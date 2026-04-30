import {
  ChangeDetectionStrategy,
  Component,
  input,
} from "@angular/core";

export type ActivityTone = "neutral" | "ok" | "warn" | "danger" | "info";

export interface IActivityEntry {
  /** Pre-formatted relative time, e.g. "2m ago" or absolute "14:22". */
  time: string;
  /** Plain text — for richer formatting use `html`. */
  text?: string;
  /** Sanitized HTML — caller's responsibility to sanitize. Used when richer markup is needed. */
  html?: string;
  tone?: ActivityTone;
}

/**
 * Vertical activity timeline. Each entry has a time pill, an optional
 * colored dot (semantic via `tone`), and a text/html body.
 */
@Component({
  selector: "app-activity-feed",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <ul class="feed">
      @for (e of entries(); track $index) {
        <li class="feed-row">
          <span class="feed-time">{{ e.time }}</span>
          <span class="feed-dot" [class]="'tone-' + (e.tone ?? 'neutral')" aria-hidden="true"></span>
          @if (e.html) {
            <span class="feed-text" [innerHTML]="e.html"></span>
          } @else {
            <span class="feed-text">{{ e.text }}</span>
          }
        </li>
      } @empty {
        <li class="feed-empty">{{ emptyText() }}</li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }
    .feed {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .feed-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 7px 0;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
    }
    .feed-row:last-child {
      border-bottom: none;
    }
    .feed-time {
      color: var(--text3);
      width: 64px;
      flex-shrink: 0;
    }
    .feed-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      margin-top: 5px;
      flex-shrink: 0;
    }
    .tone-neutral { background: var(--text3); }
    .tone-ok { background: var(--green, #16a34a); }
    .tone-warn { background: var(--yellow, #eab308); }
    .tone-danger { background: var(--red, #ef4444); }
    .tone-info { background: var(--primary, #1a66ff); }
    .feed-text {
      color: var(--text2);
      flex: 1;
      min-width: 0;
    }
    .feed-empty {
      font-size: 12px;
      color: var(--text3);
      padding: 12px 0;
      text-align: center;
      list-style: none;
    }
  `,
})
export class ActivityFeedComponent {
  readonly entries = input.required<IActivityEntry[]>();
  readonly emptyText = input<string>("Sin actividad reciente");
}
