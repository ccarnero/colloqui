import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  BadRequestException,
} from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenantId = request.headers?.[TENANT_HEADER];

    if (!tenantId || typeof tenantId !== "string") {
      throw new BadRequestException(
        `Missing required header '${TENANT_HEADER}'`,
      );
    }

    const trimmed = tenantId.trim();
    if (trimmed.length < 3 || trimmed.length > 32) {
      throw new BadRequestException(
        `Invalid tenant ID: must be 3-32 characters`,
      );
    }

    if (!/^[a-zA-Z0-9-]+$/.test(trimmed)) {
      throw new BadRequestException(
        `Invalid tenant ID: only alphanumeric and hyphen characters allowed`,
      );
    }

    request.tenantId = trimmed;
    return true;
  }
}
