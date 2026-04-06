/**
 * OAuth/API client scope: `platform` or `tenant:<slug>` (lowercase DNS-like slug).
 */
export const CLIENT_SCOPE_REGEX =
  /^(platform|tenant:[a-z0-9]([a-z0-9-]*[a-z0-9])?)$/;
