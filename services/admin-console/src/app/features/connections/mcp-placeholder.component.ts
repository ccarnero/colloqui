import { ChangeDetectionStrategy, Component } from "@angular/core";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";

/**
 * MCP — Model Context Protocol connectors.
 *
 * Phase 4 placeholder: same shell as the other connection sub-pages so
 * the swap is trivial when the backend lands. Renders an empty-state
 * card and a disabled add button.
 */
@Component({
  selector: "app-mcp-placeholder",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent],
  template: `
    <app-page-header
      title="MCP"
      subtitle="Conectores Model Context Protocol"
    >
      <div slot="actions">
        <button class="btn" type="button" disabled>+ Add MCP server</button>
      </div>
    </app-page-header>

    <section class="empty-card" aria-live="polite">
      <div class="empty-icon">⏱</div>
      <h2 class="empty-h">Backend in development</h2>
      <p class="empty-sub">
        La integración con servidores MCP está siendo construida. La interfaz
        ya está lista para mostrar y configurar conectores cuando el backend
        esté disponible.
      </p>
      <button class="btn" type="button" disabled>Notify me when ready</button>
    </section>
  `,
  styles: `
    :host { display: block; }
    .empty-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 48px 24px;
      text-align: center;
      margin-top: 16px;
    }
    .empty-icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 16px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--yellow, #eab308) 15%, transparent);
      color: var(--yellow, #b45309);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-weight: 500;
    }
    .empty-h {
      font-size: 14px;
      font-weight: 500;
      margin: 0 0 6px;
      color: var(--text-primary);
    }
    .empty-sub {
      font-size: 12px;
      color: var(--text2);
      max-width: 380px;
      margin: 0 auto 16px;
      line-height: 1.55;
    }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .btn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `,
})
export class McpPlaceholderComponent {}
