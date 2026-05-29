import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from "@nestjs/common";

import { PinoLoggerService } from "@yoizen/observability";
import type {
  CreateAdapterDto,
  UpdateAdapterDto,
  CreateEndpointDto,
  UpdateEndpointDto,
} from "./adapters.dto";
import { ADAPTER_UPDATE_FIELD_KEYS } from "./adapter-update-fields";
import {
  ADAPTERS_REPOSITORY,
  mapAdapter,
  mapEndpoint,
  type IAdaptersRepository,
  type IEndpointRow,
} from "./adapters.repository.interface";

const ENDPOINT_UPDATE_FIELD_KEYS = [
  "label",
  "method",
  "path",
  "cache",
] as const;

@Injectable()
export class AdaptersService {
  private readonly logger = new PinoLoggerService(AdaptersService.name);

  constructor(
    @Inject(ADAPTERS_REPOSITORY)
    private readonly adaptersRepository: IAdaptersRepository,
  ) {}

  /**
   * Maps Postgres unique violations (23505) to {@link ConflictException}.
   */
  private async runWithUniqueConflict<T>(
    conflictMessage: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e: unknown) {
      if (this.adaptersRepository.isUniqueViolation(e)) {
        throw new ConflictException(conflictMessage);
      }
      throw e;
    }
  }

  /**
   * Creates an adapter and optional inline endpoints for the tenant.
   *
   * @param tenantId - Tenant scope from `x-yoizen-tenant`.
   * @param dto - Validated create payload.
   * @returns Mapped adapter with nested endpoints.
   */
  async create(tenantId: string, dto: CreateAdapterDto) {
    return this.runWithUniqueConflict(
      `Adapter '${dto.name}' already exists for this tenant`,
      async () => {
        const { row, endpoints } =
          await this.adaptersRepository.insertAdapterWithEndpoints(
            tenantId,
            dto,
          );
        this.logger.log(`Created adapter '${dto.name}' for tenant ${tenantId}`);
        return {
          ...mapAdapter(row, tenantId),
          endpoints: endpoints.map(mapEndpoint),
        };
      },
    );
  }

  /**
   * Lists adapters with endpoints, optionally filtered by `context`.
   *
   * @param tenantId - Tenant scope.
   * @param context - When set, only adapters with this context.
   * @param limit - Max rows (clamped upstream).
   * @param offset - Pagination offset (clamped upstream).
   */
  async list(
    tenantId: string,
    context: string | undefined,
    limit: number,
    offset: number,
    tag?: string,
    name?: string,
  ) {
    const rows = await this.adaptersRepository.listRows(
      tenantId,
      context,
      limit,
      offset,
      tag,
      name,
    );
    const adapterIds = rows.map((r) => r.id);
    const endpoints = await this.adaptersRepository.listEndpointsForAdapters(
      tenantId,
      adapterIds,
    );

    const endpointsByAdapter = new Map<string, IEndpointRow[]>();
    for (const ep of endpoints) {
      const list = endpointsByAdapter.get(ep.adapter_id);
      if (list) {
        list.push(ep);
      } else {
        endpointsByAdapter.set(ep.adapter_id, [ep]);
      }
    }

    return rows.map((row) => ({
      ...mapAdapter(row, tenantId),
      endpoints: (endpointsByAdapter.get(row.id) ?? []).map(mapEndpoint),
    }));
  }

  /**
   * Returns a single adapter with all endpoints or throws {@link NotFoundException}.
   *
   * @param tenantId - Tenant scope.
   * @param id - Adapter id.
   */
  async get(tenantId: string, id: string) {
    const row = await this.adaptersRepository.getAdapterRow(tenantId, id);
    if (!row) {
      throw new NotFoundException(`Adapter '${id}' not found`);
    }

    const endpoints = await this.adaptersRepository.listEndpointsForAdapter(
      tenantId,
      id,
    );

    return {
      ...mapAdapter(row, tenantId),
      endpoints: endpoints.map(mapEndpoint),
    };
  }

  /**
   * Rejects mutations on adapters managed by an automated sync (e.g.
   * `registry-service` internal mirrors). The externally managed lifecycle
   * is authoritative; manual edits would be overwritten on next sync.
   */
  private async assertNotManaged(
    tenantId: string,
    id: string,
    operation: string,
  ): Promise<void> {
    const row = await this.adaptersRepository.getAdapterRow(tenantId, id);
    if (!row) {
      throw new NotFoundException(`Adapter '${id}' not found`);
    }
    if (row.managed_by) {
      throw new ConflictException(
        `Cannot ${operation} adapter '${id}' managed by '${row.managed_by}'`,
      );
    }
  }

  /**
   * Applies a partial update; no-op fields yield a fresh read via {@link get}.
   *
   * @param tenantId - Tenant scope.
   * @param id - Adapter id.
   * @param dto - Partial update DTO.
   */
  async update(tenantId: string, id: string, dto: UpdateAdapterDto) {
    await this.assertNotManaged(tenantId, id, "update");

    const hasField = ADAPTER_UPDATE_FIELD_KEYS.some(
      (k) => (dto as Record<string, unknown>)[k] !== undefined,
    );
    if (!hasField) {
      return this.get(tenantId, id);
    }

    await this.adaptersRepository.updateAdapter(tenantId, id, dto);

    this.logger.log(`Updated adapter '${id}' for tenant ${tenantId}`);
    return this.get(tenantId, id);
  }

  /**
   * Deletes an adapter (cascades endpoints).
   *
   * @param tenantId - Tenant scope.
   * @param id - Adapter id.
   */
  async remove(tenantId: string, id: string): Promise<void> {
    await this.assertNotManaged(tenantId, id, "delete");
    const count = await this.adaptersRepository.deleteAdapter(tenantId, id);
    if (count === 0) {
      throw new NotFoundException(`Adapter '${id}' not found`);
    }
    this.logger.log(`Removed adapter '${id}' for tenant ${tenantId}`);
  }

  /**
   * Adds an endpoint to an existing adapter.
   *
   * @param tenantId - Tenant scope.
   * @param adapterId - Parent adapter id.
   * @param dto - Endpoint definition.
   */
  async addEndpoint(
    tenantId: string,
    adapterId: string,
    dto: CreateEndpointDto,
  ) {
    await this.assertNotManaged(tenantId, adapterId, "add endpoint to");

    return this.runWithUniqueConflict(
      `Endpoint '${dto.method} ${dto.path}' already exists on this adapter`,
      async () => {
        const row = await this.adaptersRepository.insertEndpoint(
          tenantId,
          adapterId,
          dto,
        );
        this.logger.log(
          `Added endpoint '${dto.method} ${dto.path}' to adapter ${adapterId}`,
        );
        return mapEndpoint(row);
      },
    );
  }

  /**
   * Removes an endpoint from an adapter.
   *
   * @param tenantId - Tenant scope.
   * @param adapterId - Parent adapter id.
   * @param endpointId - Endpoint id to delete.
   */
  async removeEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<void> {
    await this.assertNotManaged(tenantId, adapterId, "remove endpoint from");

    const count = await this.adaptersRepository.deleteEndpoint(
      tenantId,
      adapterId,
      endpointId,
    );
    if (count === 0) {
      throw new NotFoundException(`Endpoint '${endpointId}' not found`);
    }
    this.logger.log(
      `Removed endpoint '${endpointId}' from adapter ${adapterId}`,
    );
  }

  /**
   * Applies a partial update to an adapter endpoint.
   *
   * @param tenantId - Tenant scope.
   * @param adapterId - Parent adapter id.
   * @param endpointId - Endpoint id to update.
   * @param dto - Partial endpoint fields.
   * @returns Updated endpoint.
   */
  async updateEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
    dto: UpdateEndpointDto,
  ) {
    await this.assertNotManaged(tenantId, adapterId, "update endpoint on");

    const hasField = ENDPOINT_UPDATE_FIELD_KEYS.some(
      (key) => (dto as Record<string, unknown>)[key] !== undefined,
    );
    if (!hasField) {
      return this.getEndpointOrThrow(tenantId, adapterId, endpointId);
    }

    return this.runWithUniqueConflict(
      `Endpoint '${endpointId}' already conflicts with an existing method/path`,
      async () => {
        await this.adaptersRepository.updateEndpoint(
          tenantId,
          adapterId,
          endpointId,
          dto,
        );
        this.logger.log(`Updated endpoint '${endpointId}' on adapter ${adapterId}`);
        return this.getEndpointOrThrow(tenantId, adapterId, endpointId);
      },
    );
  }

  private async getEndpointOrThrow(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<ReturnType<typeof mapEndpoint>> {
    const endpoint = await this.adaptersRepository.getEndpointRow(
      tenantId,
      adapterId,
      endpointId,
    );
    if (!endpoint) {
      throw new NotFoundException(`Endpoint '${endpointId}' not found`);
    }
    return mapEndpoint(endpoint);
  }
}
