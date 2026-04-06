import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import type { TokenResponse, TokenScope, UserRole } from "@yoizen/shared";
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL } from "@yoizen/shared";
import { authServiceConfig } from "../../config";
import { TokenRepository } from "./token.repository";

const REFRESH_TOKEN_SCOPE = "refresh";

interface ITokenClaims {
  sub: string;
  type: "user" | "client";
  scope: TokenScope;
  role?: UserRole;
  permissions?: string[];
  tenant_id?: string;
  email?: string;
  env: string;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly environment: string;
  private secret!: Uint8Array;

  constructor(private readonly tokenRepository: TokenRepository) {
    this.environment = authServiceConfig.platformEnvironment;
  }

  onModuleInit(): void {
    const raw = authServiceConfig.jwtSecret;
    if (!raw) {
      throw new InternalServerErrorException(
        "JWT_SECRET environment variable is required",
      );
    }
    this.secret = new TextEncoder().encode(raw);
  }

  /**
   * OAuth2-style client credentials grant for API clients.
   * @param clientId - Public client identifier.
   * @param clientSecret - Plain secret (verified against stored hash).
   * @returns Access token response (no refresh token).
   */
  async clientCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<TokenResponse> {
    const rows = await this.tokenRepository.findClientByClientId(clientId);

    if (rows.length === 0) {
      throw new UnauthorizedException("Invalid client credentials");
    }

    const client = rows[0] as {
      id: string;
      is_active: boolean;
      client_secret_hash: string;
      scope: string;
    };
    if (!client.is_active) {
      throw new UnauthorizedException("Client is deactivated");
    }

    const valid = await Bun.password.verify(
      clientSecret,
      client.client_secret_hash,
    );
    if (!valid) {
      throw new UnauthorizedException("Invalid client credentials");
    }

    const scope = client.scope as TokenScope;
    const accessToken = await this.signToken({
      sub: client.id,
      type: "client",
      scope,
      env: this.environment,
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      scope,
    };
  }

  /**
   * Password login for platform users, then tenant-scoped users when `tenantId` is set.
   * @param email - User email.
   * @param password - Plain password.
   * @param tenantId - When set, attempts tenant user login after platform miss.
   */
  async login(
    email: string,
    password: string,
    tenantId?: string,
  ): Promise<TokenResponse> {
    const platformResult = await this.tryPlatformLogin(email, password);
    if (platformResult) return platformResult;

    return this.tenantLogin(email, password, tenantId);
  }

  /**
   * Exchanges a valid refresh JWT for new access (and refresh) tokens.
   * @param refreshToken - HS256 refresh token with `token_scope: refresh`.
   */
  async refresh(refreshToken: string): Promise<TokenResponse> {
    let payload: { sub: string };
    try {
      const { payload: decoded } = await jwtVerify(refreshToken, this.secret, {
        algorithms: ["HS256"],
      });
      if (decoded.token_scope !== REFRESH_TOKEN_SCOPE) {
        throw new UnauthorizedException("Not a refresh token");
      }
      payload = { sub: decoded.sub as string };
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const platformRows = await this.tokenRepository.findPlatformUserById(
      payload.sub,
    );

    if (platformRows.length > 0) {
      const user = platformRows[0] as {
        id: string;
        is_active: boolean;
        role: string;
        email: string;
      };
      if (!user.is_active) {
        throw new UnauthorizedException("User not found or deactivated");
      }
      return this.issueTokens({
        sub: user.id,
        type: "user",
        scope: "platform",
        role: user.role as UserRole,
        email: user.email,
        env: this.environment,
      });
    }

    const tenantRows = await this.tokenRepository.findTenantUserForRefresh(
      payload.sub,
    );

    if (tenantRows.length === 0 || !(tenantRows[0] as { is_active: boolean }).is_active) {
      throw new UnauthorizedException("User not found or deactivated");
    }

    const tUser = tenantRows[0] as {
      id: string;
      tenant_id: string;
      email: string;
      role_name: string;
      is_system: boolean;
    };
    const scope: TokenScope = `tenant:${tUser.tenant_id}`;
    const permissions = await this.resolvePermissions(
      tUser.is_system,
      tUser.id,
    );

    return this.issueTokens({
      sub: tUser.id,
      type: "user",
      scope,
      role: tUser.role_name as UserRole,
      permissions,
      tenant_id: tUser.tenant_id,
      email: tUser.email,
      env: this.environment,
    });
  }

  private async tryPlatformLogin(
    email: string,
    password: string,
  ): Promise<TokenResponse | null> {
    const rows = await this.tokenRepository.findPlatformUserByEmail(email);

    if (rows.length === 0) return null;

    const user = rows[0] as {
      id: string;
      is_active: boolean;
      password_hash: string;
      role: string;
      email: string;
    };
    if (!user.is_active) {
      throw new UnauthorizedException("Account is deactivated");
    }

    const valid = await Bun.password.verify(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.issueTokens({
      sub: user.id,
      type: "user",
      scope: "platform",
      role: user.role as UserRole,
      email: user.email,
      env: this.environment,
    });
  }

  private async tenantLogin(
    email: string,
    password: string,
    tenantId?: string,
  ): Promise<TokenResponse> {
    const rows = tenantId
      ? await this.tokenRepository.findTenantUserWithTenant(email, tenantId)
      : await this.tokenRepository.findTenantUserByEmailAnyTenant(email);

    if (rows.length === 0) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (rows.length > 1) {
      throw new UnauthorizedException(
        "Email exists in multiple tenants. Please provide tenant_id.",
      );
    }

    const user = rows[0] as {
      id: string;
      tenant_id: string;
      email: string;
      password_hash: string;
      role_name: string;
      is_system: boolean;
    };
    const valid = await Bun.password.verify(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const scope: TokenScope = `tenant:${user.tenant_id}`;
    const permissions = await this.resolvePermissions(
      user.is_system,
      user.id,
    );

    return this.issueTokens({
      sub: user.id,
      type: "user",
      scope,
      role: user.role_name as UserRole,
      permissions,
      tenant_id: user.tenant_id,
      email: user.email,
      env: this.environment,
    });
  }

  private async issueTokens(claims: ITokenClaims): Promise<TokenResponse> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signToken(claims),
      this.signRefreshToken(claims.sub),
    ]);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      scope: claims.scope,
      refresh_token: refreshToken,
    };
  }

  /**
   * Resolves permission strings for a tenant user.
   * System roles (tenant_admin) get a wildcard; others get explicit permissions.
   */
  private async resolvePermissions(
    isSystem: boolean,
    userId: string,
  ): Promise<string[]> {
    if (isSystem) return ["*"];

    const rows = await this.tokenRepository.resolvePermissionsForUser(userId);

    const len = rows.length;
    const perms: string[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const r = rows[i] as { resource: string; action: string };
      perms[i] = `${r.resource}:${r.action}`;
    }
    return perms;
  }

  private async signToken(claims: ITokenClaims): Promise<string> {
    const payload: Record<string, unknown> = {
      type: claims.type,
      scope: claims.scope,
      env: claims.env,
    };

    if (claims.role) payload.role = claims.role;
    if (claims.permissions) payload.permissions = claims.permissions;
    if (claims.tenant_id) payload.tenant_id = claims.tenant_id;
    if (claims.email) payload.email = claims.email;

    const builder = new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL}s`);

    return builder.sign(this.secret);
  }

  private async signRefreshToken(sub: string): Promise<string> {
    return new SignJWT({ token_scope: REFRESH_TOKEN_SCOPE })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_TTL}s`)
      .sign(this.secret);
  }
}
