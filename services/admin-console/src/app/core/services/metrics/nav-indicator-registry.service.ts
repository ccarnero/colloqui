import { Injectable, inject, type Signal } from "@angular/core";
import { AiMetricsService } from "./ai-metrics.service";
import { ChannelsMetricsService } from "./channels-metrics.service";
import { ConnectionsMetricsService } from "./connections-metrics.service";
import { OverviewMetricsService } from "./overview-metrics.service";
import { ProcessesMetricsService } from "./processes-metrics.service";
import { SettingsMetricsService } from "./settings-metrics.service";

/**
 * Resolves a sub-nav indicator's `source` key (declared in nav.config) to a
 * live `Signal<number | null>`.
 *
 * Each section metrics service owns its own keys; the registry just routes
 * by prefix. Unknown keys return null and the indicator simply doesn't
 * render.
 */
@Injectable({ providedIn: "root" })
export class NavIndicatorRegistry {
  private readonly ai = inject(AiMetricsService);
  private readonly channels = inject(ChannelsMetricsService);
  private readonly connections = inject(ConnectionsMetricsService);
  private readonly overview = inject(OverviewMetricsService);
  private readonly processes = inject(ProcessesMetricsService);
  private readonly settings = inject(SettingsMetricsService);

  resolve(source: string): Signal<number | null> | null {
    if (source.startsWith("ai.")) {
      return this.ai.resolve(source);
    }
    if (source.startsWith("channels.")) {
      return this.channels.resolve(source);
    }
    if (source.startsWith("connections.")) {
      return this.connections.resolve(source);
    }
    if (source.startsWith("overview.")) {
      return this.overview.resolve(source);
    }
    if (source.startsWith("processes.")) {
      return this.processes.resolve(source);
    }
    if (source.startsWith("settings.")) {
      return this.settings.resolve(source);
    }
    return null;
  }
}
