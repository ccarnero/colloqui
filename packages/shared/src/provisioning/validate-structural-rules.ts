// Structural rules that cannot be expressed as a single-object zod schema
// because they span the manifest as a whole: section-scoped name
// uniqueness, the >=1-inbound-channel and >=1-process rules, and symbolic
// ref resolution (channelRef/agentRef/serviceRef/secretRef must resolve to a
// same-named entry within the manifest — `external: true` on that entry only
// tells the reconciler not to create it, it does not waive the name check).
//
// Pure function: takes an already-schema-valid manifest, returns the list of
// violations (empty when the manifest is structurally sound).

import { collectSymbolicRefs } from "./collect-symbolic-refs";
import type {
  Agent,
  Connector,
  ConnectorAuth,
  HostedService,
  IntegrationManifest,
  KnowledgeBase,
  ManifestChannel,
  SecretBinding,
  SecretScopeKind,
  Workflow,
} from "./manifest.schema";
import type { ManifestValidationError } from "./validation-error.interfaces";

/**
 * Every `{ path, secretRef }` pair inside a connector's nested `auth` block
 * (T01 gap-1 ruling) — `bearerToken`/`apiKey` (one) or `basicUsername` +
 * `basicPassword` (two), each with its own field-level path for error
 * reporting.
 */
function connectorAuthSecretRefs(
  auth: ConnectorAuth | undefined,
  basePath: string
): { path: string; secretRef: string }[] {
  if (!auth) {
    return [];
  }
  switch (auth.authType) {
    case "bearer":
      return [
        {
          path: `${basePath}.bearerToken.secretRef`,
          secretRef: auth.bearerToken.secretRef,
        },
      ];
    case "api-key":
      return [
        {
          path: `${basePath}.apiKey.secretRef`,
          secretRef: auth.apiKey.secretRef,
        },
      ];
    case "basic":
      return [
        {
          path: `${basePath}.basicUsername.secretRef`,
          secretRef: auth.basicUsername.secretRef,
        },
        {
          path: `${basePath}.basicPassword.secretRef`,
          secretRef: auth.basicPassword.secretRef,
        },
      ];
  }
}

export function validateManifestStructuralRules(
  manifest: IntegrationManifest
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  checkUniqueNames(manifest.spec.channels, "spec.channels", errors);
  checkUniqueNames(manifest.spec.connectors, "spec.connectors", errors);
  checkUniqueNames(manifest.spec.agents, "spec.agents", errors);
  checkUniqueNames(manifest.spec.knowledgeBases, "spec.knowledgeBases", errors);
  checkUniqueNames(manifest.spec.services, "spec.services", errors);
  checkUniqueNames(manifest.spec.workflows, "spec.workflows", errors);
  checkUniqueNames(manifest.spec.secrets, "spec.secrets", errors);

  checkAtLeastOneInboundChannel(manifest.spec.channels, errors);
  checkAtLeastOneProcess(manifest.spec.agents, manifest.spec.workflows, errors);
  checkRefResolution(manifest, errors);

  return errors;
}

function checkUniqueNames(
  items: ReadonlyArray<{ name: string }>,
  sectionPath: string,
  errors: ManifestValidationError[]
): void {
  const firstIndexByName = new Map<string, number>();
  items.forEach((item, index) => {
    const firstIndex = firstIndexByName.get(item.name);
    if (firstIndex !== undefined) {
      errors.push({
        path: `${sectionPath}[${index}].name`,
        message: `duplicate name "${item.name}" in ${sectionPath} (first declared at index ${firstIndex})`,
      });
      return;
    }
    firstIndexByName.set(item.name, index);
  });
}

function checkAtLeastOneInboundChannel(
  channels: ReadonlyArray<ManifestChannel>,
  errors: ManifestValidationError[]
): void {
  const hasInbound = channels.some(
    (channel) => channel.direction === "inbound"
  );
  if (!hasInbound) {
    errors.push({
      path: "spec.channels",
      message:
        "manifest must declare at least one channel with direction: inbound",
    });
  }
}

function checkAtLeastOneProcess(
  agents: ReadonlyArray<Agent>,
  workflows: ReadonlyArray<Workflow>,
  errors: ManifestValidationError[]
): void {
  if (agents.length === 0 && workflows.length === 0) {
    errors.push({
      path: "spec",
      message:
        "manifest must declare at least one process: an agent or a workflow",
    });
  }
}

function checkRefResolution(
  manifest: IntegrationManifest,
  errors: ManifestValidationError[]
): void {
  const channelNames = new Set(manifest.spec.channels.map((c) => c.name));
  const agentNames = new Set(manifest.spec.agents.map((a) => a.name));
  const serviceNames = new Set(manifest.spec.services.map((s) => s.name));
  const secretsByName = new Map(manifest.spec.secrets.map((s) => [s.name, s]));

  manifest.spec.channels.forEach((channel, index) => {
    if (channel.secretRef !== undefined) {
      checkSecretRef(
        channel.secretRef,
        `spec.channels[${index}].secretRef`,
        "channel",
        channel.name,
        secretsByName,
        errors
      );
    }
  });

  manifest.spec.connectors.forEach((connector: Connector, index) => {
    const authRefs = connectorAuthSecretRefs(
      connector.auth,
      `spec.connectors[${index}].auth`
    );
    for (const { path, secretRef } of authRefs) {
      checkSecretRef(
        secretRef,
        path,
        "connector",
        connector.name,
        secretsByName,
        errors
      );
    }
  });

  manifest.spec.agents.forEach((agent, index) => {
    (agent.knowledgeBaseRefs ?? []).forEach((kbRef, kbIndex) => {
      const knownKbNames = new Set(
        manifest.spec.knowledgeBases.map((kb: KnowledgeBase) => kb.name)
      );
      if (!knownKbNames.has(kbRef)) {
        errors.push({
          path: `spec.agents[${index}].knowledgeBaseRefs[${kbIndex}]`,
          message: `unresolved knowledgeBaseRef "${kbRef}": no knowledge base with this name in the manifest`,
        });
      }
    });
  });

  manifest.spec.services.forEach((service: HostedService, index) => {
    (service.env ?? []).forEach((envVar, envIndex) => {
      if (envVar.secretRef !== undefined) {
        checkSecretRef(
          envVar.secretRef,
          `spec.services[${index}].env[${envIndex}].secretRef`,
          "service",
          service.name,
          secretsByName,
          errors
        );
      }
    });
  });

  manifest.spec.workflows.forEach((workflow, index) => {
    const refs = collectSymbolicRefs(
      workflow.definition,
      `spec.workflows[${index}].definition`
    );
    for (const ref of refs) {
      switch (ref.refType) {
        case "channelRef":
          if (!channelNames.has(ref.value)) {
            errors.push({
              path: ref.path,
              message: `unresolved channelRef "${ref.value}": no channel with this name in the manifest`,
            });
          }
          break;
        case "agentRef":
          if (!agentNames.has(ref.value)) {
            errors.push({
              path: ref.path,
              message: `unresolved agentRef "${ref.value}": no agent with this name in the manifest`,
            });
          }
          break;
        case "serviceRef":
          if (!serviceNames.has(ref.value)) {
            errors.push({
              path: ref.path,
              message: `unresolved serviceRef "${ref.value}": no service with this name in the manifest`,
            });
          }
          break;
        case "secretRef":
          if (!secretsByName.has(ref.value)) {
            errors.push({
              path: ref.path,
              message: `unresolved secretRef "${ref.value}": no secret with this name in the manifest`,
            });
          }
          break;
      }
    }
  });
}

function checkSecretRef(
  secretName: string,
  path: string,
  expectedKind: SecretScopeKind,
  expectedOwner: string,
  secretsByName: ReadonlyMap<string, SecretBinding>,
  errors: ManifestValidationError[]
): void {
  const secret = secretsByName.get(secretName);
  if (!secret) {
    errors.push({
      path,
      message: `unresolved secretRef "${secretName}": no secret with this name in the manifest`,
    });
    return;
  }

  // External secrets are provisioned out-of-band; their scope binding is not
  // always checkable against the referencing resource (decision 4/5).
  if (secret.external) {
    return;
  }

  if (
    secret.scope.kind !== expectedKind ||
    secret.scope.owner !== expectedOwner
  ) {
    errors.push({
      path,
      message: `secretRef "${secretName}" scope binding {kind: ${secret.scope.kind}, owner: ${secret.scope.owner}} does not match the referencing resource {kind: ${expectedKind}, owner: ${expectedOwner}}`,
    });
  }
}
