import type { AuthType, HttpMethod } from "../../models/http-adapter.model";

export const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

export const AUTH_TYPE_LABELS: ReadonlyMap<AuthType, string> = new Map([
  ["none", "None"],
  ["api-key", "API Key"],
  ["bearer", "Bearer Token"],
  ["basic", "Basic Auth"],
  ["oauth2", "OAuth2 (Client Credentials)"],
]);

export function authTypeOptions(): { value: AuthType; label: string }[] {
  return [...AUTH_TYPE_LABELS.entries()].map(([value, label]) => ({
    value,
    label,
  }));
}
