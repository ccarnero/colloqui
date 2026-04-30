import { Injectable, inject, type Signal } from "@angular/core";
import { AiMetricsService } from "./ai-metrics.service";
import { AutomateMetricsService } from "./automate-metrics.service";
import { ChannelsMetricsService } from "./channels-metrics.service";
import { DataMetricsService } from "./data-metrics.service";
import { OverviewMetricsService } from "./overview-metrics.service";
import { SettingsMetricsService } from "./settings-metrics.service";

/**
 * Resolves a sub-nav indicator's `source` key (declared in nav.config) to a
 * live `Signal<number | null>`.
 *
 * Each section metrics service owns its own keys; the registry just routes
 * by prefix. Unknown keys return null and the indicator simply doesn't
 * render — that's why Phase 1 is safe even though no real metrics are
 * wired yet.
 */
@Injectable({ providedIn: "root" })
export class NavIndicatorRegistry {
  private readonly ai = inject(AiMetricsService);
  private readonly automate = inject(AutomateMetricsService);
  private readonly channels = inject(ChannelsMetricsService);
  private readonly data = inject(DataMetricsService);
  private readonly overview = inject(OverviewMetricsService);
  private readonly settings = inject(SettingsMetricsService);

  resolve(source: string): Signal<number | null> | null {
    if (source.startsWith("ai.")) {
      return this.ai.resolve(source);
    }
    if (source.startsWith("automate.")) {
      return this.automate.resolve(source);
    }
    if (source.startsWith("channels.")) {
      return this.channels.resolve(source);
    }
    if (source.startsWith("data.")) {
      return this.data.resolve(source);
    }
    if (source.startsWith("overview.")) {
      return this.overview.resolve(source);
    }
    if (source.startsWith("settings.")) {
      return this.settings.resolve(source);
    }
    // Unknown prefix → no signal, indicator hides.
    return null;
  }
}
