import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";

/** Severity of an attention issue, mapped to the redesign's dot colors. */
export type AttentionSeverity = "critical" | "warning" | "info";

/** Optional inline action rendered at the end of an issue row. */
export interface IAttentionIssueAction {
  label: string;
  /** Optional href; when absent, clicking emits `actionClick` without navigating. */
  href?: string;
}

export interface IAttentionIssue {
  id: string;
  message: string;
  severity: AttentionSeverity;
  action?: IAttentionIssueAction;
}

/**
 * "Needs attention" panel — see `Rediseño Terminal.dc.html` lines 301-319
 * (colored severity dot + message + optional action link, panel border and
 * padding). No feature-specific logic: consumers supply already-formatted
 * issue rows.
 */
@Component({
  selector: "app-needs-attention-panel",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">{{ title() }}</span>
        @if (subtitle()) {
          <span class="panel-subtitle">{{ subtitle() }}</span>
        }
      </div>
      @if (issuesWithEmptyLog().length === 0) {
        <div class="panel-empty">{{ emptyMessage() }}</div>
      } @else {
        <div class="panel-rows">
          @for (issue of issuesWithEmptyLog(); track issue.id) {
            <div class="issue-row">
              <span class="issue-dot" [class]="dotClass(issue)"></span>
              <span class="issue-message">
                {{ issue.message }}
                @if (issue.action) {
                  <a
                    class="issue-action"
                    [href]="issue.action.href ?? '#'"
                    (click)="onActionClick($event, issue)"
                    >{{ issue.action.label }} →</a
                  >
                }
              </span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-9, 10px);
      padding: var(--rd-space-9, 18px) var(--rd-space-10, 20px);
    }
    .panel-header {
      display: flex;
      align-items: baseline;
      gap: var(--rd-space-4, 8px);
    }
    .panel-title {
      font-size: var(--rd-text-size-base, 13px);
      font-weight: 500;
      color: var(--rd-text-1);
    }
    .panel-subtitle {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      color: var(--rd-text-3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .panel-rows {
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-5, 10px);
      margin-top: var(--rd-space-6, 12px);
    }
    .issue-row {
      display: flex;
      align-items: flex-start;
      gap: var(--rd-space-5, 10px);
      font-size: var(--rd-text-size-md, 12.5px);
    }
    .issue-dot {
      margin-top: 1px;
      width: 7px;
      height: 7px;
      border-radius: var(--rd-radius-full, 999px);
      flex-shrink: 0;
    }
    .issue-dot--critical {
      background: var(--rd-red);
    }
    .issue-dot--warning {
      background: var(--rd-yellow);
    }
    .issue-dot--info {
      background: var(--rd-link);
    }
    .issue-message {
      color: var(--rd-text-2);
      flex: 1;
    }
    .issue-action {
      color: var(--rd-link);
      margin-left: var(--rd-space-2, 4px);
    }
    .panel-empty {
      margin-top: var(--rd-space-6, 12px);
      font-size: var(--rd-text-size-base, 13px);
      color: var(--rd-text-3);
    }
  `,
})
export class NeedsAttentionPanelComponent {
  readonly title = input<string>("Needs attention");
  readonly subtitle = input<string | undefined>(undefined);
  readonly issues = input<IAttentionIssue[]>([]);
  readonly emptyMessage = input<string>("No issues to review");

  readonly actionClick = output<IAttentionIssue>();

  readonly issuesWithEmptyLog = computed(() => {
    const data = this.issues();
    if (data.length === 0) {
      // Verbose logging: an empty issues list must not fail silently.
      console.debug(
        "[NeedsAttentionPanelComponent] no issues to render, showing empty state",
        { emptyMessage: this.emptyMessage() }
      );
    }
    return data;
  });

  dotClass(issue: IAttentionIssue): string {
    return `issue-dot--${issue.severity}`;
  }

  onActionClick(event: MouseEvent, issue: IAttentionIssue): void {
    if (!issue.action?.href) {
      event.preventDefault();
    }
    this.actionClick.emit(issue);
  }
}
