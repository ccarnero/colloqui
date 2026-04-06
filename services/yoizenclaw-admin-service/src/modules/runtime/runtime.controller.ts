import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { RuntimeService, type IRuntimeStatus } from "./runtime.service";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

/**
 * Runtime status endpoints. Base path: /admin/runtime
 */
@Controller("admin/runtime")
@UseGuards(TenantGuard)
export class RuntimeController {
  constructor(private readonly runtimeService: RuntimeService) {}

  /**
   * Returns runtime status for a tenant.
   * GET /admin/runtime/status
   *
   * Includes whether the runtime is configured, connected runtimes, and last sync time.
   */
  @Get("status")
  @HttpCode(HttpStatus.OK)
  async getStatus(
    @TenantId() tenantId: string,
  ): Promise<IRuntimeStatus> {
    return this.runtimeService.getStatus(tenantId);
  }
}
