import { Injectable, effect, inject, type Signal } from "@angular/core";
import { AiMetricsService } from "./ai-metrics.service";
import { ChannelsMetricsService } from "./channels-metrics.service";
import { ConnectionsMetricsService } from "./connections-metrics.service";
import { OverviewMetricsService } from "./overview-metrics.service";
import { ProcessesMetricsService } from "./processes-metrics.service";
import {
  type ResourceMutationSection,
  ResourceMutationsService,
} from "./resource-mutations.service";
import { SettingsMetricsService } from "./settings-metrics.service";

/** Section service contract used by the mutation-driven reload wiring. */
interface IReloadableMetrics {
  reload(): void;
}

/**
 * Resolves a sub-nav indicator's `source` key (declared in nav.config) to a
 * live `Signal<number | null>`.
 *
 * Each section metrics service owns its own keys; the registry just routes
 * by prefix. Unknown keys return null and the indicator simply doesn't
 * render.
 *
 * The registry also reacts to `ResourceMutationsService` version bumps and
 * reloads the affected section's counts, so badges stay fresh after a
 * create/update/delete without any per-call-site wiring.
 */
@Injectable({ providedIn: "root" })
export class NavIndicatorRegistry {
  private readonly ai = inject(AiMetricsService);
  private readonly channels = inject(ChannelsMetricsService);
  private readonly connections = inject(ConnectionsMetricsService);
  private readonly overview = inject(OverviewMetricsService);
  private readonly processes = inject(ProcessesMetricsService);
  private readonly settings = inject(SettingsMetricsService);
  private readonly mutations = inject(ResourceMutationsService);

  constructor() {
    this.watchSection("ai", this.ai);
    this.watchSection("channels", this.channels);
    this.watchSection("connections", this.connections);
    this.watchSection("processes", this.processes);
    this.watchSection("settings", this.settings);
  }

  /**
   * Reloads a section's counts whenever its mutation version changes. The
   * initial value (0) is ignored so this never competes with `loadAll()`.
   */
  private watchSection(
    section: ResourceMutationSection,
    service: IReloadableMetrics,
  ): void {
    const version = this.mutations.version(section);
    effect(() => {
      if (version() > 0) {
        service.reload();
      }
    });
  }

  /**
   * Hydrates every section's "created resources" counts in one shot. Each
   * section service guards against duplicate work, so this is safe to call
   * once per authenticated session (from the shell).
   */
  loadAll(): void {
    this.ai.loadCounts();
    this.channels.loadCounts();
    this.connections.loadCounts();
    this.processes.loadCounts();
    this.settings.loadCounts();
  }

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
