import { PinoLoggerService } from "@yoizen/observability";
import {
  createTenantJsonProxyForwarder,
  downstreamJsonProxyWithStatus,
  type IDownstreamJsonProxyResult,
  type IJsonProxyRequest,
} from "./downstream-json-proxy.util";

/**
 * Shared tenant-scoped JSON proxy for downstream services (registry, workflow,
 * channel, adapter). Subclasses only supply base URL and labels.
 */
export abstract class TenantJsonProxyBase {
  private readonly baseUrl: string;
  private readonly serviceLabel: string;
  private readonly logger: PinoLoggerService;
  private readonly forward: ReturnType<typeof createTenantJsonProxyForwarder>;

  protected constructor(
    baseUrl: string,
    serviceLabel: string,
    loggerContext: string
  ) {
    this.baseUrl = baseUrl;
    this.serviceLabel = serviceLabel;
    this.logger = new PinoLoggerService(loggerContext);
    this.forward = createTenantJsonProxyForwarder(
      baseUrl,
      serviceLabel,
      this.logger
    );
  }

  async proxy(req: IJsonProxyRequest): Promise<object> {
    return this.forward(req);
  }

  /**
   * Status-aware variant (T06 gateway 202 fix,
   * `manual-loops/connector-invoke-api.md`): returns the downstream's REAL
   * success status alongside the body so a controller whose contract varies
   * by status (e.g. connector invoke's 200 sync vs 202 async accept) can
   * forward it verbatim instead of a fixed `@HttpCode`. Non-2xx statuses
   * still throw via `throwProxyError` (same as `proxy()`).
   */
  async proxyWithStatus(
    req: IJsonProxyRequest
  ): Promise<IDownstreamJsonProxyResult> {
    return downstreamJsonProxyWithStatus({
      baseUrl: this.baseUrl,
      serviceLabel: this.serviceLabel,
      logger: this.logger,
      method: req.method,
      path: req.path,
      tenantId: req.tenantId,
      query: req.query,
      body: req.body,
      signal: req.signal,
      requestId: req.requestId,
    });
  }
}
