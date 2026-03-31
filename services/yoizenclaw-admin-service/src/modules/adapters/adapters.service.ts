import { Injectable, Logger } from "@nestjs/common";
import {
  sanitizeAdapter,
  sanitizeAdapterDetail,
  type AdapterSummaryDto,
  type AdapterDetailDto,
} from "./adapters.dto";

const ADAPTER_SERVICE_URL =
  process.env.ADAPTER_SERVICE_URL ?? "http://adapter-service:3000";

@Injectable()
export class AdaptersService {
  private readonly logger = new Logger(AdaptersService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = ADAPTER_SERVICE_URL;
  }

  async findAll(tenantId: string): Promise<{ adapters: AdapterSummaryDto[] }> {
    try {
      const response = await fetch(`${this.baseUrl}/adapters`, {
        headers: { "x-yoizen-tenant": tenantId },
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

  async findOne(
    tenantId: string,
    adapterId: string,
  ): Promise<AdapterDetailDto | null> {
    try {
      const response = await fetch(`${this.baseUrl}/adapters/${adapterId}`, {
        headers: { "x-yoizen-tenant": tenantId },
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

  async adapterExists(
    tenantId: string,
    adapterId: string,
  ): Promise<boolean> {
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
