import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { gatewayConfig } from "../../config";
import {
  downstreamJsonProxy,
  type IJsonProxyRequest,
} from "../../utils/downstream-json-proxy.util";

@Injectable()
export class AdminProxyService {
  private readonly logger = new PinoLoggerService(AdminProxyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = gatewayConfig.services.admin;
  }

  /**
   * Forwards a request to the yoizenclaw-admin-service.
   */
  async proxy(req: IJsonProxyRequest): Promise<object> {
    return downstreamJsonProxy({
      baseUrl: this.baseUrl,
      method: req.method,
      path: req.path,
      tenantId: req.tenantId,
      query: req.query,
      body: req.body,
      serviceLabel: "Admin service",
      logger: this.logger,
      signal: req.signal,
    });
  }
}
