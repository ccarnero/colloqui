import { Injectable, NotFoundException } from "@nestjs/common";
import {
  sanitizeAdapter,
  sanitizeAdapterDetail,
  type AdapterSummaryDto,
  type AdapterDetailDto,
} from "./adapters.dto";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import { yoizenclawAdminServiceConfig } from "../../config";

@Injectable()
export class AdaptersService {
  private readonly logger = new PinoLoggerService(AdaptersService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = yoizenclawAdminServiceConfig.adapterServiceUrl;
  }

  async findAll(
    tenantId: string,
    tag?: string,
  ): Promise<{ adapters: AdapterSummaryDto[] }> {
    try {
      const url = new URL(`${this.baseUrl}/adapters`);
      if (tag) {
        url.searchParams.set("tag", tag);
      }

      const response = await tracedFetch(url.toString(), {
        headers: { [TENANT_HEADER]: tenantId },
      });

      if (!response.ok) {
        this.logger.warn(
          `Adapter service returned ${response.status} for tenant ${tenantId}`,
        );
        return { adapters: [] };
      }

      const rawList = (await response.json()) as Array<Record<string, unknown>>;
      return {
        adapters: rawList.map((raw) => sanitizeAdapter(raw)),
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch adapters for tenant ${tenantId}`,
        error,
      );
      return { adapters: [] };
    }
  }

  /**
   * Loads a single adapter or throws if missing (404 from downstream).
   */
  async findOneOrThrow(
    tenantId: string,
    adapterId: string,
  ): Promise<AdapterDetailDto> {
    const adapter = await this.findOne(tenantId, adapterId);
    if (!adapter) {
      throw new NotFoundException(`Adapter '${adapterId}' not found`);
    }
    return adapter;
  }

  async findOne(
    tenantId: string,
    adapterId: string,
  ): Promise<AdapterDetailDto | null> {
    try {
      const response = await tracedFetch(`${this.baseUrl}/adapters/${adapterId}`, {
        headers: { [TENANT_HEADER]: tenantId },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        this.logger.warn(
          `Adapter service returned ${response.status} for adapter ${adapterId}`,
        );
        return null;
      }

      const raw = (await response.json()) as Record<string, unknown>;
      return sanitizeAdapterDetail(raw);
    } catch (error) {
      this.logger.error(
        `Failed to fetch adapter ${adapterId} for tenant ${tenantId}`,
        error,
      );
      return null;
    }
  }

  async adapterExists(tenantId: string, adapterId: string): Promise<boolean> {
    const adapter = await this.findOne(tenantId, adapterId);
    return adapter !== null;
  }

  async endpointExists(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<boolean> {
    const adapter = await this.findOne(tenantId, adapterId);
    if (!adapter) return false;
    return adapter.endpoints.some((ep) => ep.id === endpointId);
  }
}
