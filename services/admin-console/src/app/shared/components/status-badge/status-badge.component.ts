import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

export type StatusBadgeColor =
  | "purple"
  | "blue"
  | "gray"
  | "green"
  | "yellow"
  | "red"
  | "cyan"
  | "orange"
  | "violet"
  | "slate";

/**
 * Rendering mode:
 *  - "badge" (default): pill with text — original behavior, unchanged.
 *  - "dot": health dot per the redesign (see `Rediseño Terminal.dc.html`
 *    lines 285, 1060 — colored 7px circle next to a label), used for fleet
 *    rows / service health where a pill is too heavy.
 */
export type StatusBadgeVariant = "badge" | "dot";

/** Health states for the dot variant. */
export type HealthStatus = "ok" | "warn" | "error" | "idle";

@Component({
  selector: "app-status-badge",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    @if (variant() === "dot") {
      <span class="health">
        <span
          class="health-dot"
          [class]="dotClass()"
          [attr.aria-label]="'health: ' + resolvedHealth()"
        ></span>
        @if (status()) {
          <span class="health-label">{{ status() }}</span>
        }
      </span>
    } @else {
      <span [class]="badgeClass()">{{ status() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-block;
    }
    span.badge-neutral,
    span.badge-purple,
    span.badge-blue,
    span.badge-gray,
    span.badge-green,
    span.badge-yellow,
    span.badge-red,
    span.badge-cyan,
    span.badge-orange,
    span.badge-violet,
    span.badge-slate {
      font-size: var(--rd-text-size-xs, 11px);
      font-weight: 600;
      padding: var(--rd-space-2, 4px) var(--rd-space-5, 10px);
      border-radius: var(--rd-radius-5, 6px);
      text-transform: capitalize;
    }
    .badge-neutral {
      background: var(--rd-hover);
      color: var(--rd-text-2);
      border: 1px solid var(--rd-line);
    }
    .badge-purple {
      background: color-mix(in srgb, var(--rd-purple) 18%, transparent);
      color: var(--rd-purple);
    }
    .badge-blue {
      background: color-mix(in srgb, var(--rd-accent) 18%, transparent);
      color: var(--rd-accent);
    }
    .badge-gray {
      background: var(--rd-hover);
      color: var(--rd-text-3);
      border: 1px solid var(--rd-line);
    }
    .badge-green {
      background: var(--rd-green-dim);
      color: var(--rd-green);
    }
    .badge-yellow {
      background: var(--rd-yellow-dim);
      color: var(--rd-yellow);
    }
    .badge-red {
      background: var(--rd-red-dim);
      color: var(--rd-red);
    }
    /* cyan/orange/violet/slate are not distinct hues in the redesign
     * contract (Rediseño Terminal.dc.html) — reuse the nearest existing
     * --rd-* token instead of inventing new colors. */
    .badge-cyan {
      background: color-mix(in srgb, var(--rd-link) 18%, transparent);
      color: var(--rd-link);
    }
    .badge-orange {
      background: var(--rd-yellow-dim);
      color: var(--rd-yellow);
    }
    .badge-violet {
      background: color-mix(in srgb, var(--rd-purple) 18%, transparent);
      color: var(--rd-purple);
    }
    .badge-slate {
      background: var(--rd-hover);
      color: var(--rd-text-3);
      border: 1px solid var(--rd-line);
    }

    /* Health dot variant */
    .health {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-4, 8px);
    }
    .health-dot {
      width: 7px;
      height: 7px;
      border-radius: var(--rd-radius-full, 999px);
      flex-shrink: 0;
    }
    .health-dot--ok {
      background: var(--rd-green);
    }
    .health-dot--warn {
      background: var(--rd-yellow);
    }
    .health-dot--error {
      background: var(--rd-red);
    }
    .health-dot--idle {
      background: var(--rd-text-3);
    }
    .health-label {
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-2);
      text-transform: capitalize;
    }
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<string>();
  readonly color = input<StatusBadgeColor | undefined>(undefined);

  /** Rendering mode; defaults to the original pill badge for backward compat. */
  readonly variant = input<StatusBadgeVariant>("badge");
  /** Explicit health for the dot variant; derived from `status()` when absent. */
  readonly health = input<HealthStatus | undefined>(undefined);

  private readonly normalized = computed(() =>
    this.status().toLowerCase().trim()
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

  /** Health resolved from the explicit input, falling back to status-text heuristics. */
  readonly resolvedHealth = computed<HealthStatus>(() => {
    const explicit = this.health();
    if (explicit) {
      return explicit;
    }
    const s = this.normalized();
    if (!s) {
      // Verbose logging: empty status must not silently render an unlabeled dot.
      console.debug(
        "[StatusBadgeComponent] empty status for dot variant, defaulting to idle"
      );
      return "idle";
    }
    if (s === "active" || s === "connected" || s === "ok" || s === "healthy") {
      return "ok";
    }
    if (
      s === "warn" ||
      s === "warning" ||
      s === "degraded" ||
      s === "pending"
    ) {
      return "warn";
    }
    if (s === "error" || s === "down" || s === "failed" || s === "reauth") {
      return "error";
    }
    console.debug(
      "[StatusBadgeComponent] unrecognized status for dot variant, defaulting to idle",
      { status: s }
    );
    return "idle";
  });

  readonly dotClass = computed(() => `health-dot--${this.resolvedHealth()}`);
}
