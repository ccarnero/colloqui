import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenantId ?? request.headers?.["x-yoizen-tenant"];
  },
);
