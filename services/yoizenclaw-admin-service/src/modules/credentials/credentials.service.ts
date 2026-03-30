import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import {
  CredentialsRepository,
  type CredentialWithoutValue,
  type CreateCredentialData,
  type UpdateCredentialData,
  type FindAllOptions,
} from './credentials.repository';
import { NatsPublisher } from '../../providers/nats.provider';

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private readonly repository: CredentialsRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Lista todas las credenciales con filtros y paginación.
   * NUNCA retorna el campo value por seguridad.
   */
  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ credentials: CredentialWithoutValue[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  /**
   * Obtiene una credencial por su ID.
   * NUNCA retorna el campo value por seguridad.
   */
  async findById(
    tenantId: string,
    id: string,
  ): Promise<CredentialWithoutValue> {
    const credential = await this.repository.findById(tenantId, id);
    if (!credential) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }
    return credential;
  }

  /**
   * Crea una nueva credencial.
   * FIXME: Implementar cifrado con KMS/Vault antes de producción
   */
  async create(
    tenantId: string,
    data: CreateCredentialData,
  ): Promise<CredentialWithoutValue> {
    // FIXME: Implementar validación adicional del valor antes de guardar
    // FIXME: Implementar cifrado con KMS/Vault antes de producción
    return this.repository.create(tenantId, data);
  }

  /**
   * Actualiza una credencial existente.
   * FIXME: Implementar cifrado con KMS/Vault antes de producción
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateCredentialData,
  ): Promise<CredentialWithoutValue> {
    const credential = await this.repository.update(tenantId, id, data);
    if (!credential) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    // Si se actualizó el value, emitir evento de rotación
    if (data.value !== undefined) {
      try {
        await this.natsPublisher.publishCredentialRotated(
          tenantId,
          credential.id,
          credential.type,
        );
        this.logger.log(
          `Credential '${credential.name}' updated with new value, rotation event emitted`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to emit credential.rotated event for credential '${credential.id}'`,
          error,
        );
        // No lanzamos error para no fallar la operación de actualizar
      }
    }

    return credential;
  }

  /**
   * Elimina (soft delete) una credencial.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }
  }

  /**
   * Rota el valor de una credencial y emite evento NATS.
   * FIXME: Implementar cifrado con KMS/Vault antes de producción
   */
  async rotate(
    tenantId: string,
    id: string,
    newValue: string,
    newExpiresAt?: string,
  ): Promise<CredentialWithoutValue> {
    // FIXME: Implementar validación del nuevo valor antes de rotar
    // FIXME: Implementar cifrado con KMS/Vault antes de producción

    const credential = await this.repository.rotate(
      tenantId,
      id,
      newValue,
      newExpiresAt,
    );
    if (!credential) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    // Emitir evento NATS
    try {
      await this.natsPublisher.publishCredentialRotated(
        tenantId,
        credential.id,
        credential.type,
      );
      this.logger.log(
        `Credential '${credential.name}' rotated and event emitted`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit credential.rotated event for credential '${credential.id}'`,
        error,
      );
      // No lanzamos error para no fallar la operación de rotar
    }

    return credential;
  }
}
