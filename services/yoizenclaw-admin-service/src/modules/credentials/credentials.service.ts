import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  CredentialsRepository,
  type MaskedCredential,
  type CreateProviderCredentialData,
  type UpdateProviderCredentialData,
  type FindAllOptions,
  type SyncStatus,
} from "./credentials.repository";
import { NatsPublisher } from "../../providers/nats.provider";
import {
  isSupportedProvider,
  validateProviderPayload,
  maskPayload,
  getSecretFields,
  type CredentialProvider,
} from "./providers/credential-provider.registry";
import { PinoLoggerService } from "@yoizen/observability";

export const CURRENT_SCHEMA_VERSION = 1;

@Injectable()
export class CredentialsService {
  private readonly logger = new PinoLoggerService(CredentialsService.name);

  constructor(
    private readonly repository: CredentialsRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ credentials: MaskedCredential[]; total: number }> {
    const result = await this.repository.findAll(tenantId, options);

    const maskedCredentials = result.credentials.map((cred) =>
      this.maskCredentialSecrets(cred),
    );

    return { credentials: maskedCredentials, total: result.total };
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<MaskedCredential> {
    const credential = await this.repository.findById(tenantId, id);
    if (!credential) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    return this.maskCredentialSecrets(credential);
  }

  async create(
    tenantId: string,
    data: CreateProviderCredentialData,
  ): Promise<MaskedCredential> {
    if (!isSupportedProvider(data.provider)) {
      throw new BadRequestException(
        `Unsupported provider: ${data.provider}. Supported providers: openai, anthropic, google, google-vertex, bedrock, groq, mistral, openrouter, xai, cohere, cerebras, huggingface, mock`,
      );
    }

    const validationErrors = validateProviderPayload(
      data.provider,
      data.payload,
    );
    if (validationErrors.length > 0) {
      const errorMessages = validationErrors
        .map((err) => `${err.field}: ${err.message}`)
        .join("; ");
      throw new BadRequestException(`Validation failed: ${errorMessages}`);
    }

    const missingSecrets = this.validateRequiredSecrets(
      data.provider,
      data.payload,
    );
    if (missingSecrets.length > 0) {
      throw new BadRequestException(
        `Missing required secret fields: ${missingSecrets.join(", ")}`,
      );
    }

    const createData: CreateProviderCredentialData = {
      ...data,
      schema_version: CURRENT_SCHEMA_VERSION,
    };

    this.logger.warn(
      "Credential stored without encryption - KMS/Vault integration pending",
    );

    const credential = await this.repository.create(tenantId, createData);

    this.logger.log(
      `Credential '${credential.name}' created with provider '${credential.provider}'`,
    );

    await this.emitCredentialSyncEvent(
      tenantId,
      credential.id,
      credential.provider,
    );

    return this.maskCredentialSecrets(credential);
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateProviderCredentialData,
  ): Promise<MaskedCredential> {
    const existing = await this.repository.findByIdWithPayload(tenantId, id);
    if (!existing) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    if (data.provider && !isSupportedProvider(data.provider)) {
      throw new BadRequestException(
        `Unsupported provider: ${data.provider}. Supported providers: openai, anthropic, google, google-vertex, bedrock, groq, mistral, openrouter, xai, cohere, cerebras, huggingface, mock`,
      );
    }

    const provider = data.provider ?? existing.provider;

    if (data.payload) {
      const mergedPayload = this.mergePayloadForValidation(
        existing.payload,
        data.payload,
        provider,
      );

      const validationErrors = validateProviderPayload(
        provider,
        mergedPayload,
      );
      if (validationErrors.length > 0) {
        const errorMessages = validationErrors
          .map((err) => `${err.field}: ${err.message}`)
          .join("; ");
        throw new BadRequestException(`Validation failed: ${errorMessages}`);
      }
    }

    if (data.provider && data.provider !== existing.provider) {
      data.schema_version = CURRENT_SCHEMA_VERSION;
    }

    if (data.payload) {
      this.logger.warn(
        "Credential updated without encryption - KMS/Vault integration pending",
      );
    }

    let mergedData = data;
    if (data.payload) {
      const mergedPayload = this.mergePayloadForValidation(
        existing.payload,
        data.payload,
        provider,
      );
      mergedData = { ...data, payload: mergedPayload };
    }

    const credential = await this.repository.update(tenantId, id, mergedData);
    if (!credential) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    this.logger.log(
      `Credential '${credential.name}' updated (provider: '${credential.provider}')`,
    );

    await this.emitCredentialSyncEvent(
      tenantId,
      credential.id,
      credential.provider,
    );

    return this.maskCredentialSecrets(credential);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    this.logger.log(`Credential '${id}' deleted`);

    await this.emitCredentialSyncEvent(tenantId, id, "deleted");
  }

  async rotate(
    tenantId: string,
    id: string,
    newPayload: Record<string, unknown>,
    newExpiresAt?: string,
  ): Promise<MaskedCredential> {
    const existing = await this.repository.findByIdWithPayload(tenantId, id);
    if (!existing) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    const validationErrors = validateProviderPayload(
      existing.provider,
      newPayload,
    );
    if (validationErrors.length > 0) {
      const errorMessages = validationErrors
        .map((err) => `${err.field}: ${err.message}`)
        .join("; ");
      throw new BadRequestException(`Validation failed: ${errorMessages}`);
    }

    const missingSecrets = this.validateRequiredSecrets(
      existing.provider,
      newPayload,
    );
    if (missingSecrets.length > 0) {
      throw new BadRequestException(
        `Missing required secret fields: ${missingSecrets.join(", ")}`,
      );
    }

    this.logger.warn(
      "Credential rotated without encryption - KMS/Vault integration pending",
    );

    const credential = await this.repository.rotate(
      tenantId,
      id,
      newPayload,
      newExpiresAt,
    );
    if (!credential) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    this.logger.log(`Credential '${credential.name}' rotated`);

    try {
      await this.natsPublisher.publishCredentialRotated(
        tenantId,
        credential.id,
        credential.provider,
      );
      this.logger.log(
        `Credential rotation event emitted for '${credential.id}'`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit credential rotation event for '${credential.id}'`,
        error,
      );
    }

    await this.emitCredentialSyncEvent(
      tenantId,
      credential.id,
      credential.provider,
    );

    return this.maskCredentialSecrets(credential);
  }

  async updateSyncStatus(
    tenantId: string,
    id: string,
    status: SyncStatus,
    error?: string,
  ): Promise<void> {
    const updated = await this.repository.updateSyncStatus(
      tenantId,
      id,
      status,
      error,
    );
    if (!updated) {
      throw new NotFoundException(`Credential with ID '${id}' not found`);
    }

    this.logger.log(`Credential '${id}' sync status updated to '${status}'`);
  }

  async findAllForSync(tenantId: string) {
    return this.repository.findAllForSync(tenantId);
  }

  private maskCredentialSecrets(
    credential: MaskedCredential,
  ): MaskedCredential {
    const maskedPayload = maskPayload(
      credential.provider,
      credential.payload,
      credential.has_secret,
    );

    return {
      ...credential,
      payload: maskedPayload,
    };
  }

  private validateRequiredSecrets(
    provider: CredentialProvider,
    payload: Record<string, unknown>,
  ): string[] {
    const secretFields = getSecretFields(provider);
    const missing: string[] = [];

    for (const field of secretFields) {
      const value = payload[field];
      if (value === undefined || value === null || value === "") {
        missing.push(field);
      }
    }

    return missing;
  }

  private mergePayloadForValidation(
    existing: Record<string, unknown>,
    update: Record<string, unknown>,
    provider: CredentialProvider,
  ): Record<string, unknown> {
    const secretFields = getSecretFields(provider);
    const merged = { ...existing };

    for (const [key, value] of Object.entries(update)) {
      if (value === undefined || value === null || value === "") {
        if (secretFields.includes(key) && existing[key]) {
          continue;
        }
      }
      merged[key] = value;
    }

    return merged;
  }

  private async emitCredentialSyncEvent(
    tenantId: string,
    credentialId: string,
    provider: string,
  ): Promise<void> {
    try {
      await this.natsPublisher.publishCredentialSync(
        tenantId,
        credentialId,
        provider,
      );
      this.logger.log(
        `Credential sync event emitted for '${credentialId}'`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit credential sync event for '${credentialId}'`,
        error,
      );
    }
  }
}
