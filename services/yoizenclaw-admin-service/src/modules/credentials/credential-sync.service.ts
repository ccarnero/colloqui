import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { CredentialsRepository, type ProviderCredential } from './credentials.repository';
import {
  type CredentialProvider,
} from './providers/credential-provider.registry';
import { NatsPublisher } from '../../providers/nats.provider';

const RUNTIME_CREDENTIALS_FILE_PATH = 'runtime-secrets/credentials.env';

const RUNTIME_CREDENTIAL_SUFFIX_BY_PAYLOAD_FIELD: Readonly<Record<string, string>> = {
  api_key: 'API_KEY',
  app_title: 'APP_TITLE',
  app_url: 'APP_URL',
  aws_access_key_id: 'AWS_ACCESS_KEY_ID',
  aws_profile_name: 'AWS_PROFILE',
  aws_secret_access_key: 'AWS_SECRET_ACCESS_KEY',
  aws_session_token: 'AWS_SESSION_TOKEN',
  base_url: 'BASE_URL',
  project_id: 'PROJECT_ID',
  provider_name: 'PROVIDER_NAME',
  region: 'REGION',
  service_account_file: 'SERVICE_ACCOUNT_FILE',
  service_account_info: 'SERVICE_ACCOUNT_JSON',
  service_account_json: 'SERVICE_ACCOUNT_JSON',
};

export interface SyncResult {
  credentialId: string;
  success: boolean;
  error?: string;
}

export interface CredentialsEnvOutput {
  content: string;
  credentialCount: number;
  errors: string[];
}

/**
 * Service for syncing credentials to runtime.
 *
 * Transforms provider-aware credentials into runtime environment variables
 * and materializes them into the credentials.env file format.
 */
@Injectable()
export class CredentialSyncService {
  private readonly logger = new Logger(CredentialSyncService.name);

  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly credentialsRepository: CredentialsRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Sync all active credentials to runtime format.
   * Returns the credentials.env content and sync results per credential.
   */
  async syncAllCredentials(
    tenantId: string,
    options: { failedOnly?: boolean } = {},
  ): Promise<{
    envOutput: CredentialsEnvOutput;
    results: SyncResult[];
  }> {
    this.logger.log(`Starting credential sync for tenant '${tenantId}'`);

    // Get all credentials for sync
    const credentials = await this.credentialsRepository.findAllForSync(tenantId);

    // Filter if failedOnly option is set
    const credentialsToSync = options.failedOnly
      ? credentials.filter((c) => c.sync_status === 'failed')
      : credentials;

    this.logger.log(`Syncing ${credentialsToSync.length} credentials`);

    const envVars: Record<string, string> = {};
    const providerDefaults = new Map<CredentialProvider, Record<string, string>>();
    const results: SyncResult[] = [];
    const errors: string[] = [];

    for (const credential of credentialsToSync) {
      try {
        // Validate schema version
        if (credential.schema_version !== 1) {
          throw new Error(
            `Unsupported schema version: ${credential.schema_version}`,
          );
        }

        // Validate sync status - skip manual_review_required
        if (credential.sync_status === 'manual_review_required') {
          this.logger.warn(
            `Skipping credential '${credential.id}' - requires manual review`,
          );
          continue;
        }

        const runtimeCredentialFields = this.toRuntimeCredentialFields(
          credential.payload,
        );
        const profileScopedEnvVars = this.toProfileEnvVars(
          credential.id,
          runtimeCredentialFields,
        );
        for (const [key, value] of Object.entries(profileScopedEnvVars)) {
          envVars[key] = value;
        }

        if (!providerDefaults.has(credential.provider)) {
          providerDefaults.set(credential.provider, runtimeCredentialFields);
        }

        // Update sync status to synced
        await this.credentialsRepository.updateSyncStatus(
          tenantId,
          credential.id,
          'synced',
        );

        results.push({
          credentialId: credential.id,
          success: true,
        });

        this.logger.log(`Successfully synced credential '${credential.name}'`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        this.logger.error(
          `Failed to sync credential '${credential.id}': ${errorMessage}`,
        );

        // Update sync status to failed
        await this.credentialsRepository.updateSyncStatus(
          tenantId,
          credential.id,
          'failed',
          errorMessage,
        );

        results.push({
          credentialId: credential.id,
          success: false,
          error: errorMessage,
        });

        errors.push(`Credential '${credential.name}': ${errorMessage}`);
      }
    }

    for (const [provider, runtimeCredentialFields] of providerDefaults.entries()) {
      const providerDefaultEnvVars = this.toProviderDefaultEnvVars(
        provider,
        runtimeCredentialFields,
      );

      for (const [key, value] of Object.entries(providerDefaultEnvVars)) {
        envVars[key] = value;
      }
    }

    // Generate credentials.env content
    const envContent = this.generateEnvFileContent(envVars);

    try {
      await this.natsPublisher.publishRuntimeConfigSync(
        tenantId,
        [
          {
            content: envContent,
            format: 'env',
            path: RUNTIME_CREDENTIALS_FILE_PATH,
          },
        ],
      );
      this.logger.log(
        `Published runtime credential file sync for '${RUNTIME_CREDENTIALS_FILE_PATH}'`,
      );
    } catch (error) {
      this.logger.error('Failed to publish runtime credential file sync', error);
    }

    // Emit sync completed event
    try {
      await this.natsPublisher.publishCredentialSyncCompleted(
        tenantId,
        results.filter((r) => r.success).length,
        results.filter((r) => !r.success).length,
      );
    } catch (error) {
      this.logger.error('Failed to emit credential sync completed event', error);
    }

    this.logger.log(
      `Credential sync completed: ${results.filter((r) => r.success).length} successful, ${results.filter((r) => !r.success).length} failed`,
    );

    return {
      envOutput: {
        content: envContent,
        credentialCount: credentialsToSync.length,
        errors,
      },
      results,
    };
  }

  /**
   * Sync a single credential to runtime.
   * Used when a specific credential is created/updated.
   */
  async syncCredential(
    tenantId: string,
    credentialId: string,
  ): Promise<SyncResult> {
    this.logger.log(`Syncing credential '${credentialId}' for tenant '${tenantId}'`);

    const credential = await this.credentialsRepository.findByIdWithPayload(
      tenantId,
      credentialId,
    );

    if (!credential) {
      return {
        credentialId,
        success: false,
        error: 'Credential not found',
      };
    }

    if (!credential.is_active) {
      return {
        credentialId,
        success: false,
        error: 'Credential is not active',
      };
    }

    try {
      // Validate schema version
      if (credential.schema_version !== 1) {
        throw new Error(
          `Unsupported schema version: ${credential.schema_version}`,
        );
      }

      const runtimeCredentialFields = this.toRuntimeCredentialFields(
        credential.payload,
      );
      const profileScopedEnvVars = this.toProfileEnvVars(
        credential.id,
        runtimeCredentialFields,
      );

      // Log what would be synced (without exposing secrets)
      const envVarKeys = Object.keys(profileScopedEnvVars);
      this.logger.log(
        `Credential '${credential.name}' produces env vars: ${envVarKeys.join(', ')}`,
      );

      // Update sync status to synced
      await this.credentialsRepository.updateSyncStatus(
        tenantId,
        credential.id,
        'synced',
      );

      this.logger.log(`Successfully synced credential '${credential.name}'`);

      return {
        credentialId,
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to sync credential '${credentialId}': ${errorMessage}`,
      );

      // Update sync status to failed
      await this.credentialsRepository.updateSyncStatus(
        tenantId,
        credentialId,
        'failed',
        errorMessage,
      );

      return {
        credentialId,
        success: false,
        error: errorMessage,
      };
    }
  }

  private toRuntimeCredentialFields(
    payload: Record<string, unknown>,
  ): Record<string, string> {
    const runtimeCredentialFields: Record<string, string> = {};

    for (const [fieldName, rawValue] of Object.entries(payload)) {
      const suffix = RUNTIME_CREDENTIAL_SUFFIX_BY_PAYLOAD_FIELD[fieldName];
      if (!suffix || rawValue === undefined || rawValue === null || rawValue === '') {
        continue;
      }

      runtimeCredentialFields[suffix] =
        typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
    }

    return runtimeCredentialFields;
  }

  private toProfileEnvVars(
    credentialId: string,
    runtimeCredentialFields: Record<string, string>,
  ): Record<string, string> {
    const segment = this.toEnvSegment(credentialId);
    const envVars: Record<string, string> = {};

    for (const [suffix, value] of Object.entries(runtimeCredentialFields)) {
      envVars[`LLM_CREDENTIAL_${segment}_${suffix}`] = value;
    }

    return envVars;
  }

  private toProviderDefaultEnvVars(
    provider: CredentialProvider,
    runtimeCredentialFields: Record<string, string>,
  ): Record<string, string> {
    const segment = this.toEnvSegment(provider);
    const envVars: Record<string, string> = {};

    for (const [suffix, value] of Object.entries(runtimeCredentialFields)) {
      envVars[`LLM_CREDENTIAL_${segment}_DEFAULT_${suffix}`] = value;
    }

    return envVars;
  }

  private toEnvSegment(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase();
  }

  /**
   * Generate credentials.env file content from environment variables.
   */
  private generateEnvFileContent(
    envVars: Record<string, string>,
  ): string {
    const lines: string[] = [
      '# Auto-generated credentials.env file',
      '# DO NOT EDIT MANUALLY - Managed by YoizenClaw Admin Service',
      `# Generated at: ${new Date().toISOString()}`,
      '',
    ];

    // Sort keys for deterministic output
    const sortedKeys = Object.keys(envVars).sort();

    for (const key of sortedKeys) {
      const value = envVars[key];
      // Escape special characters in value
      const escapedValue = this.escapeEnvValue(value);
      lines.push(`${key}=${escapedValue}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Escape special characters in environment variable value.
   */
  private escapeEnvValue(value: string): string {
    // If value contains spaces, quotes, or special chars, wrap in quotes
    if (/[\s"'#$&;|<>(){}\[\]*?]/.test(value)) {
      // Escape double quotes
      const escaped = value.replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    return value;
  }
}
