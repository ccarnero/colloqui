// Template: Auth with Tenant
// JWT que incluye tenant

import jwt from "jsonwebtoken";
import { ok, err, type Result } from "../lib/result.js";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export interface TokenPayload {
  sub: string;      // user ID
  tenant: string;   // tenant slug
  iat: number;
  exp: number;
}

/**
 * Crea un JWT que incluye el tenant
 */
export function createToken(userId: string, tenant: string): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  
  return jwt.sign(
    { 
      sub: userId,
      tenant, // ← incluir tenant en el token
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verifica un JWT y retorna el payload con tenant
 */
export function verifyToken(token: string): Result<TokenPayload, string> {
  if (!JWT_SECRET) {
    return err("jwt_secret_not_configured");
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    
    // Validar que el token tiene tenant
    if (!decoded.tenant) {
      return err("token_missing_tenant");
    }
    
    return ok(decoded);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return err("token_expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return err("invalid_token");
    }
    return err(`token_verification_failed: ${error}`);
  }
}

/**
 * Middleware para verificar JWT y extraer auth context
 */
export function requireAuth(req: any, res: any, next: any): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  
  const token = authHeader.substring(7);
  const result = verifyToken(token);
  
  if (!result.ok) {
    res.status(401).json({ error: result.error });
    return;
  }
  
  // Agregar auth al request
  req.auth = {
    userId: result.data.sub,
    tenant: result.data.tenant
  };
  
  next();
}

/**
 * Valida que el tenant del JWT coincide con el del request
 * Usar después de resolveTenant middleware
 */
export function validateTenantConsistency(
  req: any, 
  res: any, 
  next: any
): void {
  const tokenTenant = req.auth?.tenant;
  const requestTenant = req.tenant;
  
  if (tokenTenant && requestTenant && tokenTenant !== requestTenant) {
    res.status(403).json({
      error: "tenant_mismatch",
      message: "Token tenant does not match request tenant",
      tokenTenant,
      requestTenant
    });
    return;
  }
  
  next();
}
