// Template: Subject Builder
// Build NATS subjects following the convention

interface SubjectParams {
  tenant: string;
  producer: string;
  domain: string;
  channel: string;
  provider: string;
  kind: "ingress" | "agent_outbound" | "agent_action" | "agent_observation";
  version?: string;
}

/**
 * Builds a NATS subject following the convention:
 * evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1
 */
export function buildSubject(params: SubjectParams): string {
  const version = params.version ?? "v1";
  return `evt.${params.tenant}.${params.producer}.${params.domain}.${params.channel}.${params.provider}.${params.kind}.${version}`;
}

/**
 * Builds a wildcard pattern for subscriptions
 */
export function buildWildcard(
  tenant?: string,
  domain?: string,
  channel?: string,
  kind?: string
): string {
  const parts = ["evt"];
  parts.push(tenant ?? "*");
  parts.push("coexistance"); // producer is fixed
  parts.push(domain ?? "*");
  parts.push(channel ?? "*");
  parts.push("*"); // provider wildcard
  parts.push(kind ?? ">");
  return parts.join(".");
}

// Ejemplos:
// buildSubject({ tenant: "acme", producer: "coexistance", domain: "messaging", channel: "whatsapp", provider: "meta", kind: "ingress" })
// → evt.acme.coexistance.messaging.whatsapp.meta.ingress.v1

// buildWildcard("acme", "messaging", "whatsapp")
// → evt.acme.coexistance.messaging.whatsapp.*.>
