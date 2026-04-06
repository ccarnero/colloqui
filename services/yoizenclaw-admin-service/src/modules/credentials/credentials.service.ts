import { Injectable, NotFoundException } from "@nestjs/common";
import {
  CredentialsRepository,
  type CredentialWithoutValue,
  type CreateCredentialData,
  type UpdateCredentialData,
  type IFindAllOptions,
} from "./credentials.repository";
import { NatsPublisher } from "../../providers/nats.provider";
import { PinoLoggerService } from "@yoizen/observability";

/** Parameters for rotating a credential secret. */
interface IRotateCredentialParams {
  readonly tenantId: string;
  readonly id: string;
  readonly newValue: string;
  readonly newExpiresAt?: string;
}

@Injectable()
export class CredentialsService {
  private readonly logger = new PinoLoggerService(CredentialsService.name);

  constructor(
    private readonly repository: CredentialsRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Lists all credentials with optional filters and pagination.
   * Never returns the `value` field for security.
   */
  async findAll(
    tenantId: string,
    options: IFindAllOptions = {},
  ): Promise<{ credentials: CredentialWithoutValue[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  /**
   * Gets a credential by id.
   * Never returns the `value` field for security.
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
   * Creates a new credential.
   * FIXME: Implement encryption with KMS/Vault before production.
   */
  async create(
    tenantId: string,
    data: CreateCredentialData,
  ): Promise<CredentialWithoutValue> {
    // FIXME: Add additional validation for the secret value before persisting.
    // FIXME: Implement encryption with KMS/Vault before production.
    return this.repository.create(tenantId, data);
  }

  /**
   * Updates an existing credential.
   * FIXME: Implement encryption with KMS/Vault before production.
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

    // If the secret value was updated, emit a rotation event.
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
        // Do not fail the update if the event publish fails.
      }
    }

    return credential;
  }

  /**
   * Soft-deletes a credential.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }
  }

  /**
   * Rotates a credential secret and emits a NATS event.
   * FIXME: Implement encryption with KMS/Vault before production.
   */
  async rotate(params: IRotateCredentialParams): Promise<CredentialWithoutValue> {
    const { tenantId, id, newValue, newExpiresAt } = params;
    // FIXME: Validate the new secret value before persisting.
    // FIXME: Implement encryption with KMS/Vault before production.

    const credential = await this.repository.rotate({
      tenantId,
      id,
      newValue,
      newExpiresAt,
    });
    if (!credential) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    // Emit NATS event.
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
      // Do not fail the rotate if the event publish fails.
    }

    return credential;
  }
}
