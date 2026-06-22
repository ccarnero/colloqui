import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";

import { PinoLoggerService } from "@yoizen/observability";
import { ADAPTER_UPDATE_FIELD_KEYS } from "./adapter-update-fields";
import {
  ADAPTER_USAGE_REPOSITORY,
  type AdapterUsagePostgresRepository,
  type IAdapterUsageRow,
} from "./adapter-usage.postgres.repository";
import type {
  CreateAdapterDto,
  CreateEndpointDto,
  UpdateAdapterDto,
  UpdateEndpointDto,
} from "./adapters.dto";
import {
  ADAPTERS_REPOSITORY,
  type IAdaptersRepository,
  type IEndpointRow,
  mapAdapter,
  mapEndpoint,
} from "./adapters.repository.interface";

const ENDPOINT_UPDATE_FIELD_KEYS = [
  "label",
  "method",
  "path",
  "cache",
] as const;

/**
 * DTO keys whose values are owned by the external sync lifecycle (e.g.
 * `registry-service` internal mirrors). Editing any of these on a
 * managed adapter is rejected because the next `upsertMirror` event
 * would silently overwrite the change. Every other field (auth,
 * headers, timeouts, retries, tags, cache) is safe to edit — the sync
 * never touches it — so operators may override those freely.
 *
 * Backed by a `Set` for O(1) membership checks on the update hot path.
 */
const REGISTRY_OWNED_FIELD_KEYS: ReadonlySet<string> = new Set([
  "name",
  "baseUrl",
  "healthCheckPath",
  "status",
]);

/**
 * Editable adapter fields on a managed adapter — the complement of
 * {@link REGISTRY_OWNED_FIELD_KEYS}. Surfaced verbatim in the 409 body
 * so the UI can tell the user exactly what they *can* change.
 */
const MANAGED_EDITABLE_FIELD_KEYS: readonly string[] =
  ADAPTER_UPDATE_FIELD_KEYS.filter(
    (key) => !REGISTRY_OWNED_FIELD_KEYS.has(key)
  );

/** Structured 409 body for managed-adapter conflicts (UI-consumable). */
interface IManagedAdapterConflict {
  readonly statusCode: 409;
  readonly error: "Conflict";
  readonly reason: "MANAGED_ADAPTER";
  readonly message: string;
  readonly adapterId: string;
  readonly managedBy: string;
  readonly lockedFields: readonly string[];
  readonly editableFields: readonly string[];
}

/** Default rolling window for adapter usage queries (days). */
const DEFAULT_USAGE_WINDOW_DAYS = 7;

@Injectable()
export class AdaptersService {
  private readonly logger = new PinoLoggerService(AdaptersService.name);

  constructor(
    @Inject(ADAPTERS_REPOSITORY)
    private readonly adaptersRepository: IAdaptersRepository,
    @Optional()
    @Inject(ADAPTER_USAGE_REPOSITORY)
    private readonly usageRepository: AdapterUsagePostgresRepository | null,
  ) {}

  /**
   * Maps Postgres unique violations (23505) to {@link ConflictException}.
   */
  private async runWithUniqueConflict<T>(
    conflictMessage: string,
    fn: () => Promise<T>
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
            dto
          );
        this.logger.log(`Created adapter '${dto.name}' for tenant ${tenantId}`);
        return {
          ...mapAdapter(row, tenantId),
          endpoints: endpoints.map(mapEndpoint),
        };
      }
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
    name?: string
  ) {
    const rows = await this.adaptersRepository.listRows(
      tenantId,
      context,
      limit,
      offset,
      tag,
      name
    );
    const adapterIds = rows.map((r) => r.id);
    const endpoints = await this.adaptersRepository.listEndpointsForAdapters(
      tenantId,
      adapterIds
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
      id
    );

    return {
      ...mapAdapter(row, tenantId),
      endpoints: endpoints.map(mapEndpoint),
    };
  }

  /**
   * Loads an adapter row or throws {@link NotFoundException}. Centralises
   * the existence check so every mutation shares one read.
   */
  private async getRowOrThrow(tenantId: string, id: string) {
    const row = await this.adaptersRepository.getAdapterRow(tenantId, id);
    if (!row) {
      throw new NotFoundException(`Adapter '${id}' not found`);
    }
    return row;
  }

  /**
   * Field-level guard for managed adapters. Unmanaged adapters pass
   * through untouched. For managed adapters, only the registry-owned
   * fields ({@link REGISTRY_OWNED_FIELD_KEYS}) are locked; the conflict
   * names exactly which fields were rejected and which remain editable
   * so the UI can render a precise, actionable message.
   */
  private assertManagedFieldsEditable(
    id: string,
    managedBy: string | null,
    dto: UpdateAdapterDto
  ): void {
    if (!managedBy) {
      return;
    }
    const lockedFields: string[] = [];
    for (const key of REGISTRY_OWNED_FIELD_KEYS) {
      if ((dto as Record<string, unknown>)[key] !== undefined) {
        lockedFields.push(key);
      }
    }
    if (lockedFields.length === 0) {
      return;
    }
    const body: IManagedAdapterConflict = {
      statusCode: 409,
      error: "Conflict",
      reason: "MANAGED_ADAPTER",
      message:
        `Adapter '${id}' is synced from '${managedBy}'. ` +
        `These fields are controlled by the sync and can't be edited here: ` +
        `${lockedFields.join(", ")}. ` +
        `You can still edit: ${MANAGED_EDITABLE_FIELD_KEYS.join(", ")}.`,
      adapterId: id,
      managedBy,
      lockedFields,
      editableFields: MANAGED_EDITABLE_FIELD_KEYS,
    };
    throw new ConflictException(body);
  }

  /**
   * Applies a partial update; no-op fields yield a fresh read via {@link get}.
   * Managed adapters accept edits to non-registry-owned fields only.
   *
   * @param tenantId - Tenant scope.
   * @param id - Adapter id.
   * @param dto - Partial update DTO.
   */
  async update(tenantId: string, id: string, dto: UpdateAdapterDto) {
    const row = await this.getRowOrThrow(tenantId, id);
    this.assertManagedFieldsEditable(id, row.managed_by, dto);

    const hasField = ADAPTER_UPDATE_FIELD_KEYS.some(
      (k) => (dto as Record<string, unknown>)[k] !== undefined
    );
    if (!hasField) {
      return this.get(tenantId, id);
    }

    await this.adaptersRepository.updateAdapter(tenantId, id, dto);

    this.logger.log(`Updated adapter '${id}' for tenant ${tenantId}`);
    return this.get(tenantId, id);
  }

  /**
   * Deletes an adapter (cascades endpoints). Managed adapters cannot be
   * deleted manually — the sync would recreate them on the next event —
   * so a structured 409 is returned instead.
   *
   * @param tenantId - Tenant scope.
   * @param id - Adapter id.
   */
  async remove(tenantId: string, id: string): Promise<void> {
    const row = await this.getRowOrThrow(tenantId, id);
    if (row.managed_by) {
      const body: IManagedAdapterConflict = {
        statusCode: 409,
        error: "Conflict",
        reason: "MANAGED_ADAPTER",
        message:
          `Adapter '${id}' is synced from '${row.managed_by}' and can't be ` +
          `deleted here — it would be recreated automatically on the next ` +
          `sync. Remove the source service from the registry instead.`,
        adapterId: id,
        managedBy: row.managed_by,
        lockedFields: ["*"],
        editableFields: MANAGED_EDITABLE_FIELD_KEYS,
      };
      throw new ConflictException(body);
    }
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
    dto: CreateEndpointDto
  ) {
    await this.getRowOrThrow(tenantId, adapterId);

    return this.runWithUniqueConflict(
      `Endpoint '${dto.method} ${dto.path}' already exists on this adapter`,
      async () => {
        const row = await this.adaptersRepository.insertEndpoint(
          tenantId,
          adapterId,
          dto
        );
        this.logger.log(
          `Added endpoint '${dto.method} ${dto.path}' to adapter ${adapterId}`
        );
        return mapEndpoint(row);
      }
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
    endpointId: string
  ): Promise<void> {
    await this.getRowOrThrow(tenantId, adapterId);

    const count = await this.adaptersRepository.deleteEndpoint(
      tenantId,
      adapterId,
      endpointId
    );
    if (count === 0) {
      throw new NotFoundException(`Endpoint '${endpointId}' not found`);
    }
    this.logger.log(
      `Removed endpoint '${endpointId}' from adapter ${adapterId}`
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
    dto: UpdateEndpointDto
  ) {
    await this.getRowOrThrow(tenantId, adapterId);

    const hasField = ENDPOINT_UPDATE_FIELD_KEYS.some(
      (key) => (dto as Record<string, unknown>)[key] !== undefined
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
          dto
        );
        this.logger.log(
          `Updated endpoint '${endpointId}' on adapter ${adapterId}`
        );
        return this.getEndpointOrThrow(tenantId, adapterId, endpointId);
      }
    );
  }

  /**
   * Returns per-adapter call usage stats over a rolling window.
   * Throws {@link ServiceUnavailableException} when the usage repository
   * is not configured (e.g. postgres-usage-shared not deployed in dev).
   *
   * @param tenantId   - Tenant scope.
   * @param windowDays - Rolling window in days (default: 7).
   */
  async getUsage(
    tenantId: string,
    windowDays: number = DEFAULT_USAGE_WINDOW_DAYS
  ): Promise<readonly IAdapterUsageRow[]> {
    if (!this.usageRepository) {
      throw new ServiceUnavailableException(
        "Usage metrics are not available in this environment"
      );
    }
    return this.usageRepository.getTopByCallCount(tenantId, windowDays);
  }

  private async getEndpointOrThrow(
    tenantId: string,
    adapterId: string,
    endpointId: string
  ): Promise<ReturnType<typeof mapEndpoint>> {
    const endpoint = await this.adaptersRepository.getEndpointRow(
      tenantId,
      adapterId,
      endpointId
    );
    if (!endpoint) {
      throw new NotFoundException(`Endpoint '${endpointId}' not found`);
    }
    return mapEndpoint(endpoint);
  }
}
