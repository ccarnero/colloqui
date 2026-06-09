import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { PermanentError } from "@yoizen/shared";

const DEFAULT_MAX_DEPTH = 5;

export class DepthExceededError extends PermanentError {
  constructor(
    public readonly depth: number,
    public readonly maxDepth: number,
    public readonly tenant: string,
  ) {
    super(
      `depth=${depth} >= MAX_DEPTH=${maxDepth} (tenant=${tenant})`,
      "depth-tracker",
    );
    this.name = "DepthExceededError";
  }
}

@Injectable()
export class DepthTrackerService {
  private readonly logger = new PinoLoggerService(DepthTrackerService.name);

  enforceDepthLimit(
    envelope: Record<string, unknown>,
    maxDepth: number = DEFAULT_MAX_DEPTH,
  ): void {
    const transport = envelope["transport"] as
      | Record<string, unknown>
      | undefined;
    const currentDepth =
      (transport?.["depth"] as number | undefined) ?? 0;
    const tenant = (envelope["tenant"] as string) ?? "unknown";

    if (currentDepth >= maxDepth) {
      this.logger.warn(
        `[depth-tracker] Depth exceeded: depth=${currentDepth} >= max=${maxDepth} tenant='${tenant}'`,
      );
      throw new DepthExceededError(currentDepth, maxDepth, tenant);
    }
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
