import {
  ChangeDetectionStrategy,
  Component,
  input,
} from "@angular/core";
import { PageHeaderComponent } from "../page-header/page-header.component";

/**
 * Composition shell for a section landing page (Channels, AI, Automate, Data, Settings).
 *
 * Slots:
 *   [slot=actions]   — buttons in the page header right side
 *   [slot=kpis]      — row of KPI cards (place an `<app-kpi-card>` grid here)
 *   [slot=primary]   — main content panel (left in 2-col, full-width otherwise)
 *   [slot=secondary] — optional right panel; if absent, [slot=primary] spans full width
 *
 * The shell does not impose a card grid on slot=kpis — pages choose 3 or 4
 * column layouts themselves so they can vary by section.
 */
@Component({
  selector: "app-section-landing-shell",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent],
  template: `
    <div class="landing">
      <app-page-header [title]="title()" [subtitle]="subtitle()">
        <ng-container slot="actions">
          <ng-content select="[slot=actions]" />
        </ng-container>
      </app-page-header>

      <section class="landing-kpis">
        <ng-content select="[slot=kpis]" />
      </section>

      <section class="landing-body" [class.landing-body-split]="hasSecondary()">
        <div class="landing-primary">
          <ng-content select="[slot=primary]" />
        </div>
        @if (hasSecondary()) {
          <div class="landing-secondary">
            <ng-content select="[slot=secondary]" />
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .landing {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .landing-kpis {
      display: contents;
    }
    .landing-body {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    .landing-body-split {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    @media (max-width: 900px) {
      .landing-body-split {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class SectionLandingShellComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | undefined>(undefined);
  /** Pages set this to true when projecting [slot=secondary] content. */
  readonly hasSecondary = input<boolean>(false);
}
