import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  MAX_DEPTH_BY_CATEGORY,
  PermanentError,
  type ProducerCategory,
} from "@yoizen/shared";

/**
 * Category assumed when a caller does not declare one. Mirrors the
 * `overrides.category ?? "internal_service"` default that `deriveEnvelope`
 * and `buildEventEnvelope` apply in `packages/shared/src/envelope.utils.ts`,
 * so an undeclared producer gets the same ceiling here as it would there.
 *
 * The envelope itself carries no category field (see DOCS/messaging/envelope.md
 * §2.1), which is why the category is a parameter and not read off the wire.
 */
const DEFAULT_CATEGORY: ProducerCategory = "internal_service";

export class DepthExceededError extends PermanentError {
  constructor(
    public readonly depth: number,
    public readonly maxDepth: number,
    public readonly tenant: string,
    public readonly category: ProducerCategory = DEFAULT_CATEGORY,
  ) {
    super(
      `depth=${depth} > MAX_DEPTH=${maxDepth} (category=${category}, tenant=${tenant})`,
      "depth-tracker",
    );
    this.name = "DepthExceededError";
  }
}

@Injectable()
export class DepthTrackerService {
  private readonly logger = new PinoLoggerService(DepthTrackerService.name);

  /**
   * Anti-loop enforcement (D12). The shared library is canonical: reject
   * with a STRICT `>` against `MAX_DEPTH_BY_CATEGORY`, exactly like
   * `deriveEnvelope` / `buildEventEnvelope` do
   * (`packages/shared/src/envelope.utils.ts`), and never against a local
   * copy of the limits.
   *
   * A depth EQUAL to the category limit is accepted — it is the last hop
   * the chain is allowed to take. The previous local implementation used
   * `depth >= 5` against its own hardcoded ceiling, which rejected one
   * level early and ignored the per-category ceilings
   * (`platform_agent: 3`, `thirdparty_agent: 2`). See
   * DOCS/messaging/envelope.md §6.3.
   */
  enforceDepthLimit(
    envelope: Record<string, unknown>,
    category: ProducerCategory = DEFAULT_CATEGORY,
  ): void {
    const transport = envelope["transport"] as
      | Record<string, unknown>
      | undefined;
    const currentDepth =
      (transport?.["depth"] as number | undefined) ?? 0;
    const tenant = (envelope["tenant"] as string) ?? "unknown";

    // Total lookup for a well-typed category; the fallback only fires for
    // untyped (JS) callers passing a category outside `ProducerCategory`,
    // and mirrors the shared default-ceiling fallback. Never silent.
    let effectiveCategory = category;
    let maxDepth = MAX_DEPTH_BY_CATEGORY[category];
    if (maxDepth === undefined) {
      effectiveCategory = DEFAULT_CATEGORY;
      maxDepth = MAX_DEPTH_BY_CATEGORY[DEFAULT_CATEGORY];
      this.logger.warn(
        `[depth-tracker] Unknown producer category '${String(category)}' tenant='${tenant}'; ` +
          `falling back to category='${DEFAULT_CATEGORY}' max=${maxDepth}`,
      );
    }

    if (currentDepth > maxDepth) {
      this.logger.warn(
        `[depth-tracker] Depth exceeded: depth=${currentDepth} > max=${maxDepth} ` +
          `category='${effectiveCategory}' tenant='${tenant}'`,
      );
      throw new DepthExceededError(
        currentDepth,
        maxDepth,
        tenant,
        effectiveCategory,
      );
    }

    this.logger.debug(
      `[depth-tracker] Depth within limit: depth=${currentDepth} max=${maxDepth} ` +
        `category='${effectiveCategory}' tenant='${tenant}'`,
    );
  }

  incrementDepth(
    envelope: Record<string, unknown>,
  ): Record<string, unknown> {
    const transport = {
      ...((envelope["transport"] as Record<string, unknown> | undefined) ?? {}),
    };
    transport["depth"] = ((transport["depth"] as number | undefined) ?? 0) + 1;

    return {
      ...envelope,
      transport,
      causation_id: envelope["id"] ?? null,
    };
  }
}
