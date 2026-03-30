import { Component, computed, input } from "@angular/core";

export type StatusBadgeColor =
  | "purple"
  | "blue"
  | "gray"
  | "green"
  | "yellow"
  | "red";

@Component({
  selector: "app-status-badge",
  standalone: true,
  imports: [],
  template: `
    <span [class]="badgeClass()">{{ status() }}</span>
  `,
  styles: `
    :host {
      display: inline-block;
    }
    span {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: var(--radius2, 6px);
      text-transform: capitalize;
    }
    .badge-neutral {
      background: var(--bg3, #2a2a2a);
      color: var(--text2, #aaa);
      border: 1px solid var(--border, #444);
    }
    .badge-purple {
      background: color-mix(in srgb, var(--purple, #a855f7) 18%, transparent);
      color: var(--purple, #a855f7);
    }
    .badge-blue {
      background: color-mix(in srgb, var(--accent, #4f7ef8) 18%, transparent);
      color: var(--accent, #4f7ef8);
    }
    .badge-gray {
      background: var(--bg3, #2a2a2a);
      color: var(--text3, #888);
      border: 1px solid var(--border, #444);
    }
    .badge-green {
      background: color-mix(in srgb, var(--green, #22c55e) 18%, transparent);
      color: var(--green, #22c55e);
    }
    .badge-yellow {
      background: color-mix(in srgb, var(--yellow, #eab308) 18%, transparent);
      color: var(--yellow, #eab308);
    }
    .badge-red {
      background: color-mix(in srgb, var(--red, #ef4444) 18%, transparent);
      color: var(--red, #ef4444);
    }
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<string>();
  readonly color = input<StatusBadgeColor | undefined>(undefined);

  private readonly normalized = computed(() =>
    this.status().toLowerCase().trim(),
  );

  readonly badgeClass = computed(() => {
    const c = this.color();
    if (c) {
      return `badge-${c}`;
    }
    const s = this.normalized();
    if (s === "active") {
      return "badge-green";
    }
    if (s === "inactive" || s === "revoked" || s === "error") {
      return "badge-gray";
    }
    if (s === "pending") {
      return "badge-yellow";
    }
    return "badge-neutral";
  });
}
