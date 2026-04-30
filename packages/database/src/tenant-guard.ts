import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  BadRequestException,
  createParamDecorator,
} from "@nestjs/common";

const TENANT_HEADER = "x-yoizen-tenant";
const TENANT_ID_PATTERN = /^[a-zA-Z0-9-]{3,32}$/;

/**
 * NestJS guard that validates the `x-yoizen-tenant` header.
 * Sets `request.tenantId` for downstream use with `@TenantId()`.
 *
 * Usage:
 * ```
 * @Controller("example")
 * @UseGuards(TenantGuard)
 * export class ExampleController { ... }
 * ```
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const raw = request.headers?.[TENANT_HEADER];

    if (!raw || typeof raw !== "string") {
      throw new BadRequestException(
        `Missing required header '${TENANT_HEADER}'`,
      );
    }

    const tenantId = raw.trim();
    if (!TENANT_ID_PATTERN.test(tenantId)) {
      throw new BadRequestException(
        "Invalid tenant ID: must be 3-32 alphanumeric/hyphen characters",
      );
    }

    request.tenantId = tenantId;
    return true;
  }
}

/**
 * Parameter decorator that extracts the validated tenant ID
 * set by `TenantGuard`. Falls back to the raw header when
 * guard is not active (not recommended).
 *
 * Usage:
 * ```
 * @Get()
 * async list(@TenantId() tenantId: string) { ... }
 * ```
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenantId ?? request.headers?.["x-yoizen-tenant"];
  },
);
