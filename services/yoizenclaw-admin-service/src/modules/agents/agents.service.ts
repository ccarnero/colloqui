import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { AgentsRepository, type Agent, type CreateAgentData, type UpdateAgentData } from './agents.repository';
import { NatsPublisher } from '../../providers/nats.provider';

export interface FindAllOptions {
  status?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly repository: AgentsRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Lista todos los agents con filtros y paginación.
   */
  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ agents: Agent[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  /**
   * Obtiene un agent por su ID.
   */
  async findById(tenantId: string, id: string): Promise<Agent> {
    const agent = await this.repository.findById(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  /**
   * Crea un nuevo agent.
   */
  async create(tenantId: string, data: CreateAgentData): Promise<Agent> {
    return this.repository.create(tenantId, data);
  }

  /**
   * Actualiza un agent existente.
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateAgentData,
  ): Promise<Agent> {
    const agent = await this.repository.update(tenantId, id, data);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  /**
   * Elimina (soft delete) un agent.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
  }

  /**
   * Publica un agent y emite evento NATS.
   */
  async publish(tenantId: string, id: string): Promise<Agent> {
    const agent = await this.repository.publish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    // Emitir evento NATS
    try {
      await this.natsPublisher.publishAgentPublished(
        tenantId,
        agent.id,
        agent.name,
      );
      this.logger.log(`Agent '${agent.name}' published and event emitted`);
    } catch (error) {
      this.logger.error(
        `Failed to emit agent.published event for agent '${agent.id}'`,
        error,
      );
      // No lanzamos error para no fallar la operación de publicar
      // pero logueamos el problema
    }

    return agent;
  }

  /**
   * Despublica un agent y emite evento NATS.
   */
  async unpublish(tenantId: string, id: string): Promise<Agent> {
    const agent = await this.repository.unpublish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    // Emitir evento NATS
    try {
      await this.natsPublisher.publishAgentUnpublished(
        tenantId,
        agent.id,
        agent.name,
      );
      this.logger.log(`Agent '${agent.name}' unpublished and event emitted`);
    } catch (error) {
      this.logger.error(
        `Failed to emit agent.unpublished event for agent '${agent.id}'`,
        error,
      );
      // No lanzamos error para no fallar la operación de despublicar
    }

    return agent;
  }
}
