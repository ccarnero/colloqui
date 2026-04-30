// Template: Resolve Tenant Middleware
// Middleware completo para resolución de tenant

import { Request, Response, NextFunction } from "express";

interface AuthContext {
  sub: string;
  tenant: string;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: string;
      auth?: AuthContext;
    }
  }
}

const DEFAULT_TENANT = process.env.DEFAULT_TENANT;

/**
 * Extrae el subdomain desde el header Host
 */
function extractSubdomain(host: string | undefined): string | null {
  if (!host) return null;
  if (host.includes("localhost") || /^[\d.:]+$/.test(host)) return null;
  
  const reserved = ["api", "www", "admin", "app"];
  const subdomain = host.split(".")[0].toLowerCase();
  
  return reserved.includes(subdomain) ? null : subdomain;
}

/**
 * Middleware para resolver el tenant desde múltiples fuentes
 */
export function resolveTenant(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Extraer de todas las fuentes posibles
  const fromSubdomain = extractSubdomain(req.headers.host);
  const fromHeader = req.headers["x-tenant-id"] as string | undefined;
  const fromPath = req.params?.tenantId as string | undefined; // para webhooks
  const fromJwt = req.auth?.tenant;
  
  // Recolectar fuentes presentes
  const sources: string[] = [
    fromSubdomain,
    fromHeader,
    fromPath,
    fromJwt
  ].filter((s): s is string => Boolean(s));
  
  // Fallback para desarrollo
  if (sources.length === 0 && DEFAULT_TENANT) {
    sources.push(DEFAULT_TENANT);
  }
  
  // Validar que hay al menos una fuente
  if (sources.length === 0) {
    res.status(400).json({
      error: "tenant_not_resolved",
      message: "Tenant no resuelto. Proveer via subdomain, header X-Tenant-Id, o JWT"
    });
    return;
  }
  
  // Validar consistencia (todas las fuentes deben coincidir)
  const unique = [...new Set(sources)];
  if (unique.length > 1) {
    res.status(403).json({
      error: "tenant_mismatch",
      message: "Fuentes de tenant en conflicto",
      sources: {
        subdomain: fromSubdomain,
        header: fromHeader,
        path: fromPath,
        jwt: fromJwt
      }
    });
    return;
  }
  
  // Asignar tenant y continuar
  req.tenant = unique[0];
  next();
}

/**
 * Middleware para extraer tenant de webhooks (path parameter)
 */
export function resolveWebhookTenant(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tenantId = req.params?.tenantId;
  
  if (!tenantId) {
    res.status(400).json({
      error: "tenant_not_in_path",
      message: "Webhook URL debe incluir :tenantId"
    });
    return;
  }
  
  req.tenant = tenantId;
  next();
}
