import type { IJwtPayload } from "./auth-types";

/**
 * Decodes the JWT payload segment (no signature verification; for UI only).
 */
export function decodeJwtPayload(token: string): IJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload) as IJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Builds two-letter initials from an email local-part for avatars.
 */
export function extractInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const segments = local.split(/[._-]/).filter(Boolean);
  if (segments.length >= 2) {
    return (segments[0][0] + segments[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

/**
 * Turns `tenant_admin` into `Tenant Admin` for display.
 */
export function formatRole(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
