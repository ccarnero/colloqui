import { BadRequestException } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";

/**
 * Validates `x-yoizen-tenant` (or configured header) for tenant-scoped list endpoints.
 */
export function requireTenantHeader(value: string | undefined): string {
  const id = value?.trim();
  if (!id) {
    throw new BadRequestException(`Missing or empty ${TENANT_HEADER} header`);
  }
  return id;
}
