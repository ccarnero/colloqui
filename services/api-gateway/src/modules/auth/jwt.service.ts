import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { jwtVerify } from "jose";
import type { JwtPayload } from "@yoizen/shared";
import { gatewayConfig } from "../../config";

@Injectable()
export class JwtService implements OnModuleInit {
  private secret!: Uint8Array;

  onModuleInit(): void {
    const raw = gatewayConfig.jwtSecret;
    if (!raw) {
      throw new InternalServerErrorException(
        "JWT_SECRET environment variable is required",
      );
    }
    this.secret = new TextEncoder().encode(raw);
  }

  /**
   * Verifies a Bearer JWT using HS256 and returns the typed payload.
   * @param token Raw JWT string (no `Bearer` prefix).
   * @throws UnauthorizedException when verification fails.
   */
  async verify(token: string): Promise<JwtPayload> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],
      });
      return payload as unknown as JwtPayload;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
