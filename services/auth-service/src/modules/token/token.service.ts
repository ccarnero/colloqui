import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { POSTGRES_SQL, type Sql } from '../../providers/postgres.provider';
import type {
  JwtPayload,
  TokenResponse,
  TokenScope,
  UserRole,
} from '@yoizen/shared';
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL } from '@yoizen/shared';

const REFRESH_TOKEN_SCOPE = 'refresh';

interface TokenClaims {
  sub: string;
  type: 'user' | 'client';
  scope: TokenScope;
  role?: UserRole;
  tenant_id?: string;
  email?: string;
  env: string;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private readonly environment: string;
  private secret!: Uint8Array;

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {
    this.environment = process.env.PLATFORM_ENVIRONMENT ?? 'dev';
  }

  onModuleInit(): void {
    const raw = process.env.JWT_SECRET;
    if (!raw) throw new Error('JWT_SECRET environment variable is required');
    this.secret = new TextEncoder().encode(raw);
  }

  async clientCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<TokenResponse> {
    const rows = await this.sql`
      SELECT id, client_secret_hash, scope, is_active
      FROM api_clients
      WHERE client_id = ${clientId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    const client = rows[0];
    if (!client.is_active) {
      throw new UnauthorizedException('Client is deactivated');
    }

    const valid = await Bun.password.verify(clientSecret, client.client_secret_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    const scope = client.scope as TokenScope;
    const accessToken = await this.signToken({
      sub: client.id,
      type: 'client',
      scope,
      env: this.environment,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope,
    };
  }

  async login(
    email: string,
    password: string,
    tenantId?: string,
  ): Promise<TokenResponse> {
    const platformResult = await this.tryPlatformLogin(email, password);
    if (platformResult) return platformResult;

    return this.tenantLogin(email, password, tenantId);
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    let payload: { sub: string };
    try {
      const { payload: decoded } = await jwtVerify(refreshToken, this.secret, {
        algorithms: ['HS256'],
      });
      if (decoded.token_scope !== REFRESH_TOKEN_SCOPE) {
        throw new Error('Not a refresh token');
      }
      payload = { sub: decoded.sub as string };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const platformRows = await this.sql`
      SELECT id, email, role, is_active
      FROM platform_users
      WHERE id = ${payload.sub}
      LIMIT 1
    `;

    if (platformRows.length > 0) {
      const user = platformRows[0];
      if (!user.is_active) {
        throw new UnauthorizedException('User not found or deactivated');
      }
      return this.issueTokens({
        sub: user.id,
        type: 'user',
        scope: 'platform',
        role: user.role as UserRole,
        email: user.email as string,
        env: this.environment,
      });
    }

    const tenantRows = await this.sql`
      SELECT id, tenant_id, email, role, is_active
      FROM tenant_users
      WHERE id = ${payload.sub}
      LIMIT 1
    `;

    if (tenantRows.length === 0 || !tenantRows[0].is_active) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    const tUser = tenantRows[0];
    const scope: TokenScope = `tenant:${tUser.tenant_id}`;

    return this.issueTokens({
      sub: tUser.id as string,
      type: 'user',
      scope,
      role: tUser.role as UserRole,
      tenant_id: tUser.tenant_id as string,
      email: tUser.email as string,
      env: this.environment,
    });
  }

  async verify(token: string): Promise<JwtPayload> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
      });
      return payload as unknown as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async tryPlatformLogin(
    email: string,
    password: string,
  ): Promise<TokenResponse | null> {
    const rows = await this.sql`
      SELECT id, email, password_hash, role, is_active
      FROM platform_users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (rows.length === 0) return null;

    const user = rows[0];
    if (!user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const valid = await Bun.password.verify(password, user.password_hash as string);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens({
      sub: user.id as string,
      type: 'user',
      scope: 'platform',
      role: user.role as UserRole,
      email: user.email as string,
      env: this.environment,
    });
  }

  private async tenantLogin(
    email: string,
    password: string,
    tenantId?: string,
  ): Promise<TokenResponse> {
    const rows = tenantId
      ? await this.sql`
          SELECT id, tenant_id, email, password_hash, role, is_active
          FROM tenant_users
          WHERE email = ${email} AND tenant_id = ${tenantId} AND is_active = true
          LIMIT 1
        `
      : await this.sql`
          SELECT id, tenant_id, email, password_hash, role, is_active
          FROM tenant_users
          WHERE email = ${email} AND is_active = true
        `;

    if (rows.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (rows.length > 1) {
      throw new UnauthorizedException(
        'Email exists in multiple tenants. Please provide tenant_id.',
      );
    }

    const user = rows[0];
    const valid = await Bun.password.verify(password, user.password_hash as string);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const scope: TokenScope = `tenant:${user.tenant_id}`;

    return this.issueTokens({
      sub: user.id as string,
      type: 'user',
      scope,
      role: user.role as UserRole,
      tenant_id: user.tenant_id as string,
      email: user.email as string,
      env: this.environment,
    });
  }

  private async issueTokens(claims: TokenClaims): Promise<TokenResponse> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signToken(claims),
      this.signRefreshToken(claims.sub),
    ]);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope: claims.scope,
      refresh_token: refreshToken,
    };
  }

  private async signToken(claims: TokenClaims): Promise<string> {
    const payload: Record<string, unknown> = {
      type: claims.type,
      scope: claims.scope,
      env: claims.env,
    };

    if (claims.role) payload.role = claims.role;
    if (claims.tenant_id) payload.tenant_id = claims.tenant_id;
    if (claims.email) payload.email = claims.email;

    const builder = new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL}s`);

    return builder.sign(this.secret);
  }

  private async signRefreshToken(sub: string): Promise<string> {
    return new SignJWT({ token_scope: REFRESH_TOKEN_SCOPE })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_TTL}s`)
      .sign(this.secret);
  }
}
