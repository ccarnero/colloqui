import {
  Injectable,
  signal,
  type Signal,
  type WritableSignal,
} from "@angular/core";

/**
 * Sub-nav sections whose "created resources" badges can be invalidated when
 * the underlying data changes (create / update / delete).
 */
export type ResourceMutationSection =
  | "ai"
  | "channels"
  | "connections"
  | "processes"
  | "settings";

/**
 * Lightweight, dependency-free event bus that data services use to signal a
 * resource mutation. Each section exposes a monotonic "version" signal; the
 * NavIndicatorRegistry reacts to version bumps and reloads that section's
 * counts. Kept as a leaf service to avoid a circular dependency
 * (data -> mutations, registry -> mutations + metrics).
 */
@Injectable({ providedIn: "root" })
export class ResourceMutationsService {
  private readonly versions = new Map<
    ResourceMutationSection,
    WritableSignal<number>
  >();

  /** Read-only version signal for a section (created lazily on first use). */
  version(section: ResourceMutationSection): Signal<number> {
    return this.ensure(section);
  }

  /** Bumps a section's version, prompting subscribers to reload counts. */
  notify(section: ResourceMutationSection): void {
    const version = this.ensure(section);
    version.set(version() + 1);
  }

  private ensure(
    section: ResourceMutationSection,
  ): WritableSignal<number> {
    let version = this.versions.get(section);
    if (!version) {
      version = signal(0);
      this.versions.set(section, version);
    }
    return version;
  }
}
