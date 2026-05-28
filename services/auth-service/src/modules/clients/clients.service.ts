import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { hashSecret } from "../../utils/password";
import { PinoLoggerService } from "@yoizen/observability";
import {
  CLIENTS_REPOSITORY,
  type IClientRow,
  type IClientsRepository,
} from "./clients.repository.interface";
import type { ICreatedClient } from "./clients.types";

@Injectable()
export class ClientsService {
  private readonly logger = new PinoLoggerService(ClientsService.name);

  constructor(
    @Inject(CLIENTS_REPOSITORY)
    private readonly clientsRepository: IClientsRepository,
  ) {}

  async create(name: string, scope: string): Promise<ICreatedClient> {
    const id = crypto.randomUUID();
    const clientId = `yoizen_${crypto.randomUUID().replace(/-/g, "")}`;
    const clientSecret = `ysk_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;

    const secretHash = await hashSecret(clientSecret);

    const rows = await this.clientsRepository.insertClient({
      id,
      clientId,
      secretHash,
      name,
      scope,
    });

    this.logger.log(`Created API client '${name}' with scope '${scope}'`);

    return {
      ...(rows[0] as IClientRow),
      client_secret: clientSecret,
    };
  }

  async list(tenantId?: string): Promise<Omit<IClientRow, "is_active">[]> {
    if (tenantId) {
      const tenantScope = `tenant:${tenantId}`;
      const rows = await this.clientsRepository.listForTenant(tenantScope);
      return rows as unknown as Omit<IClientRow, "is_active">[];
    }

    const rows = await this.clientsRepository.listAllActive();
    return rows as unknown as Omit<IClientRow, "is_active">[];
  }

  async revoke(id: string): Promise<void> {
    const ok = await this.clientsRepository.revokeClient(id);
    if (!ok) {
      throw new NotFoundException(
        `Client '${id}' not found or already revoked`,
      );
    }

    this.logger.log(`Revoked API client ${id}`);
  }
}
