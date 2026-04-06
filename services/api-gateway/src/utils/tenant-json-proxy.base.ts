import { PinoLoggerService } from "@yoizen/observability";
import {
  createTenantJsonProxyForwarder,
  type IJsonProxyRequest,
} from "./downstream-json-proxy.util";

/**
 * Shared tenant-scoped JSON proxy for downstream services (registry, workflow,
 * channel, adapter, scheduler). Subclasses only supply base URL and labels.
 */
export abstract class TenantJsonProxyBase {
  private readonly forward: ReturnType<typeof createTenantJsonProxyForwarder>;

  protected constructor(
    baseUrl: string,
    serviceLabel: string,
    loggerContext: string,
  ) {
    const logger = new PinoLoggerService(loggerContext);
    this.forward = createTenantJsonProxyForwarder(baseUrl, serviceLabel, logger);
  }

  async proxy(req: IJsonProxyRequest): Promise<object> {
    return this.forward(req);
  }
}
