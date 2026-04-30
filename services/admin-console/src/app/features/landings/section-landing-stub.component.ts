import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { SectionLandingShellComponent } from "../../shared/components/section-landing-shell/section-landing-shell.component";

/**
 * Phase 1 placeholder for all section landings (Channels / AI / Automate /
 * Data / Settings). Each section's route is wired to this stub with a
 * `data: { sectionTitle, sectionSubtitle }` payload. Phase 2 replaces each
 * route's component with its real, populated landing.
 *
 * Kept dumb on purpose — it only renders the shell with a "coming soon"
 * note so we can ship the routing skeleton without empty white screens.
 */
@Component({
  selector: "app-section-landing-stub",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionLandingShellComponent],
  template: `
    <app-section-landing-shell
      [title]="title()"
      [subtitle]="subtitle()"
    >
      <div slot="primary" class="stub-note">
        <p>Esta vista se completará en la Fase 2.</p>
        <p class="stub-help">
          La estructura de navegación está lista; las métricas y paneles se conectarán a continuación.
        </p>
      </div>
    </app-section-landing-shell>
  `,
  styles: `
    :host {
      display: block;
    }
    .stub-note {
      padding: 32px 20px;
      background: var(--bg-surface);
      border: 1px dashed var(--border-subtle);
      border-radius: var(--radius, 6px);
      text-align: center;
      color: var(--text2);
    }
    .stub-note p {
      margin: 0;
      font-size: 14px;
    }
    .stub-help {
      margin-top: 8px !important;
      color: var(--text3);
      font-size: 13px !important;
    }
  `,
})
export class SectionLandingStubComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly data = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data,
  });

  readonly title = computed<string>(
    () => (this.data()?.["sectionTitle"] as string | undefined) ?? "Sección",
  );
  readonly subtitle = computed<string | undefined>(
    () => this.data()?.["sectionSubtitle"] as string | undefined,
  );
}
