// Zod schema + inferred types for the declarative provisioning
// `IntegrationManifest` (manual-loops/declarative-provisioning.md, task T01).
//
// This is the feature's public YAML contract, human-approved BEFORE
// implementation. Do not change field/section names without a new
// human approval round.
//
// The manifest holds structure and wiring ONLY:
// - `services` carries hosted-service REFERENCES (image or buildRef) —
//   never inline code.
// - `secrets` carries name + scope BINDINGS only — never values.
//
// Every object schema is `.strict()` so unknown keys fail loud instead of
// being silently dropped.

import { z } from "zod";

/** Size cap for inline KB document content (bytes, UTF-8). */
export const KB_INLINE_CONTENT_MAX_BYTES = 64 * 1024;

/** Reconciliation ids are by `name`: non-empty, slug-like, unique per section. */
export const nameSchema = z
  .string()
  .min(1, "name must not be empty")
  .max(63, "name must be at most 63 characters")
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    "name must be slug-like: lowercase alphanumeric characters and hyphens, not starting or ending with a hyphen"
  );

// ---------------------------------------------------------------------------
// Symbolic refs — plain string names resolved against the manifest's own
// sections (or against an `external: true` entry declared for out-of-band
// resources).
// ---------------------------------------------------------------------------

export const channelRefSchema = nameSchema;
export const agentRefSchema = nameSchema;
export const serviceRefSchema = nameSchema;
export const secretRefSchema = nameSchema;
// manual-loops/provisioning-manifest-gaps.md T03, gap 3 — lets a workflow/
// agent definition reference a connector by manifest name, mirroring
// channelRef/agentRef/serviceRef exactly (same `nameSchema`, same
// resolve-by-name-at-apply-time semantics).
export const connectorRefSchema = nameSchema;

export const SYMBOLIC_REF_KEYS = [
  "channelRef",
  "agentRef",
  "serviceRef",
  "secretRef",
  "connectorRef",
] as const;

export type SymbolicRefType = (typeof SYMBOLIC_REF_KEYS)[number];

// ---------------------------------------------------------------------------
// Knowledge base sources — discriminated union: inline | file | url.
// ---------------------------------------------------------------------------

const kbSourceInlineSchema = z
  .object({
    type: z.literal("inline"),
    content: z
      .string()
      .min(1, "inline content must not be empty")
      .max(
        KB_INLINE_CONTENT_MAX_BYTES,
        `inline content must be at most ${KB_INLINE_CONTENT_MAX_BYTES} bytes`
      ),
  })
  .strict();

const kbSourceFileSchema = z
  .object({
    type: z.literal("file"),
    path: z.string().min(1, "file path must not be empty"),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, "sha256 must be a 64-character hex digest"),
  })
  .strict();

const kbSourceUrlSchema = z
  .object({
    type: z.literal("url"),
    url: z.url("url must be a valid absolute URL"),
  })
  .strict();

export const kbSourceSchema = z.discriminatedUnion("type", [
  kbSourceInlineSchema,
  kbSourceFileSchema,
  kbSourceUrlSchema,
]);

export type KbSource = z.infer<typeof kbSourceSchema>;

const kbDocumentSchema = z
  .object({
    name: nameSchema,
    source: kbSourceSchema,
  })
  .strict();

export type KbDocument = z.infer<typeof kbDocumentSchema>;

const knowledgeBaseSchema = z
  .object({
    name: nameSchema,
    documents: z
      .array(kbDocumentSchema)
      .min(1, "knowledge base must declare at least one document"),
    external: z.boolean().optional(),
  })
  .strict();

export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

// ---------------------------------------------------------------------------
// Channels — at least one with direction "inbound" is required manifest-wide.
// ---------------------------------------------------------------------------

const channelDirectionSchema = z.enum(["inbound", "outbound"]);

const channelSchema = z
  .object({
    name: nameSchema,
    type: z.string().min(1, "channel type must not be empty"),
    direction: channelDirectionSchema,
    config: z.record(z.string(), z.unknown()).optional(),
    secretRef: secretRefSchema.optional(),
    external: z.boolean().optional(),
  })
  .strict();

// Named `ManifestChannel` (not `Channel`) to avoid colliding with the
// existing top-level `Channel` provider-kind type in channel.interfaces.ts.
export type ManifestChannel = z.infer<typeof channelSchema>;
export type ChannelDirection = z.infer<typeof channelDirectionSchema>;

// ---------------------------------------------------------------------------
// Connectors — credential wiring (manual-loops/provisioning-manifest-gaps.md
// T01, decision 3 ruling 2026-07-16): secretRef-ONLY, with NESTED-FIELD
// TARGETING. There is no literal inline `authConfig` field — a plaintext
// credential in the manifest is impossible by schema. Instead a connector
// declares an `auth` block: `authType` plus, per authType, the exact
// connector-admin `authConfig` field(s) each `secretRef` targets (mirrors
// `channelSchema.secretRef`, extended because different authTypes need
// different — and for `basic`, multiple — authConfig keys). Values are
// resolved through the secrets broker only, never persisted to the manifest.
// ---------------------------------------------------------------------------

const connectorSecretFieldSchema = z
  .object({
    secretRef: secretRefSchema,
  })
  .strict();

export type ConnectorSecretField = z.infer<typeof connectorSecretFieldSchema>;

const connectorBearerAuthSchema = z
  .object({
    authType: z.literal("bearer"),
    bearerToken: connectorSecretFieldSchema,
  })
  .strict();

const connectorApiKeyAuthSchema = z
  .object({
    authType: z.literal("api-key"),
    apiKey: connectorSecretFieldSchema,
    // Non-secret: the HEADER NAME the resolved key is sent under, never a value.
    apiKeyHeader: z.string().min(1).optional(),
  })
  .strict();

const connectorBasicAuthSchema = z
  .object({
    authType: z.literal("basic"),
    basicUsername: connectorSecretFieldSchema,
    basicPassword: connectorSecretFieldSchema,
  })
  .strict();

export const connectorAuthSchema = z.discriminatedUnion("authType", [
  connectorBearerAuthSchema,
  connectorApiKeyAuthSchema,
  connectorBasicAuthSchema,
]);

export type ConnectorAuth = z.infer<typeof connectorAuthSchema>;
export type ConnectorAuthType = ConnectorAuth["authType"];

// ---------------------------------------------------------------------------
// Connector endpoints (manual-loops/provisioning-manifest-gaps.md T02, gap 2)
// — mirrors `sdk/src/resources/connectors/types.ts` `CreateConnectorEndpointInput`
// (itself `CreateEndpointDto` in connector-admin: `label`/`method`/`path`/
// `cache`). Endpoint uniqueness downstream is `(method, path)` per connector,
// not a manifest-declared id — the writer matches on that pair to decide
// add-vs-update (T02). No secrets: endpoints carry only routing metadata.
// ---------------------------------------------------------------------------

const connectorEndpointCacheMethodSchema = z.enum([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const connectorEndpointCacheSchema = z
  .object({
    enabled: z.boolean(),
    ttlSeconds: z.number().int().min(1),
    methods: z.array(connectorEndpointCacheMethodSchema).optional(),
    keyHeaders: z.array(z.string()).optional(),
    keyQueryParams: z.union([z.array(z.string()), z.literal("all")]).optional(),
    keyBody: z.boolean().optional(),
  })
  .strict();

export type ConnectorEndpointCache = z.infer<
  typeof connectorEndpointCacheSchema
>;

const connectorEndpointHttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const connectorEndpointSchema = z
  .object({
    label: z.string().min(1, "endpoint label must not be empty"),
    method: connectorEndpointHttpMethodSchema,
    path: z.string().min(1, "endpoint path must not be empty"),
    cache: connectorEndpointCacheSchema.optional(),
  })
  .strict();

export type ConnectorEndpointManifest = z.infer<typeof connectorEndpointSchema>;

const connectorSchema = z
  .object({
    name: nameSchema,
    type: z.string().min(1, "connector type must not be empty"),
    config: z.record(z.string(), z.unknown()).optional(),
    auth: connectorAuthSchema.optional(),
    endpoints: z.array(connectorEndpointSchema).optional(),
    external: z.boolean().optional(),
  })
  .strict();

export type Connector = z.infer<typeof connectorSchema>;

// ---------------------------------------------------------------------------
// Agents — a "process" for the >=1-process structural rule.
// ---------------------------------------------------------------------------

const agentSchema = z
  .object({
    name: nameSchema,
    profile: z.record(z.string(), z.unknown()),
    knowledgeBaseRefs: z.array(nameSchema).optional(),
    external: z.boolean().optional(),
  })
  .strict();

export type Agent = z.infer<typeof agentSchema>;

// ---------------------------------------------------------------------------
// Hosted services — REFERENCES only (image or buildRef), never inline code.
// ---------------------------------------------------------------------------

const serviceEnvVarSchema = z
  .object({
    name: z.string().min(1, "env var name must not be empty"),
    secretRef: secretRefSchema.optional(),
  })
  .strict();

export type ServiceEnvVar = z.infer<typeof serviceEnvVarSchema>;

const serviceSchema = z
  .object({
    name: nameSchema,
    image: z.string().min(1).optional(),
    buildRef: z.string().min(1).optional(),
    env: z.array(serviceEnvVarSchema).optional(),
    external: z.boolean().optional(),
  })
  .strict()
  .superRefine((service, ctx) => {
    const hasImage = service.image !== undefined;
    const hasBuildRef = service.buildRef !== undefined;
    if (hasImage === hasBuildRef) {
      ctx.addIssue({
        code: "custom",
        message:
          "exactly one of image or buildRef must be set — hosted services are referenced by image or build, never by inline code",
        path: ["image"],
      });
    }
  });

export type HostedService = z.infer<typeof serviceSchema>;

// ---------------------------------------------------------------------------
// Workflows — the other "process" kind. `definition` is an opaque record
// whose steps may embed channelRef/agentRef/serviceRef/secretRef/
// connectorRef keys at any depth; those are walked and resolved by the
// structural-rule validators, not by this schema. `connectorRef` (T03,
// gap 3) additionally participates in manifest-time real-ID substitution
// (see `services/provisioning-service/.../substitution-allowlist.ts`) —
// this schema only validates the ref's own shape (a plain name string),
// never the substitution semantics.
// ---------------------------------------------------------------------------

const workflowSchema = z
  .object({
    name: nameSchema,
    definition: z.record(z.string(), z.unknown()),
    external: z.boolean().optional(),
  })
  .strict();

export type Workflow = z.infer<typeof workflowSchema>;

// ---------------------------------------------------------------------------
// Secrets — bindings only: {name, scope: {kind, owner}}. Never values.
// ---------------------------------------------------------------------------

const secretScopeKindSchema = z.enum([
  "channel",
  "connector",
  "agent",
  "service",
  "workflow",
]);

const secretScopeSchema = z
  .object({
    kind: secretScopeKindSchema,
    owner: nameSchema,
  })
  .strict();

export type SecretScope = z.infer<typeof secretScopeSchema>;
export type SecretScopeKind = z.infer<typeof secretScopeKindSchema>;

const secretSchema = z
  .object({
    name: nameSchema,
    scope: secretScopeSchema,
    external: z.boolean().optional(),
  })
  .strict();

export type SecretBinding = z.infer<typeof secretSchema>;

// ---------------------------------------------------------------------------
// Manifest root
// ---------------------------------------------------------------------------

const manifestMetadataSchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export type IntegrationManifestMetadata = z.infer<
  typeof manifestMetadataSchema
>;

const manifestSpecSchema = z
  .object({
    channels: z.array(channelSchema).default([]),
    connectors: z.array(connectorSchema).default([]),
    agents: z.array(agentSchema).default([]),
    knowledgeBases: z.array(knowledgeBaseSchema).default([]),
    services: z.array(serviceSchema).default([]),
    workflows: z.array(workflowSchema).default([]),
    secrets: z.array(secretSchema).default([]),
  })
  .strict();

export type IntegrationManifestSpec = z.infer<typeof manifestSpecSchema>;

export const integrationManifestSchema = z
  .object({
    apiVersion: z.literal("yoizen.io/v1"),
    kind: z.literal("IntegrationManifest"),
    metadata: manifestMetadataSchema,
    spec: manifestSpecSchema,
  })
  .strict();

export type IntegrationManifest = z.infer<typeof integrationManifestSchema>;
