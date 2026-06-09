import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { agentSchedulerServiceConfig } from "../../config";

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const apiKey = agentSchedulerServiceConfig.adminApiKey;

    if (!apiKey) {
      throw new ForbiddenException(
        "Admin API key not configured — admin endpoints are disabled",
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers: { "x-internal-api-key"?: string };
    }>();

    const provided = request.headers["x-internal-api-key"];

    if (!provided || provided !== apiKey) {
      throw new ForbiddenException("Invalid or missing admin API key");
    }

    return true;
  }
}
