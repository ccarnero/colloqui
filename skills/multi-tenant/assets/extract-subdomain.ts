// Template: Extract Subdomain
// Extrae el tenant desde el header Host

/**
 * Extrae el subdomain (tenant) desde un host.
 * Retorna null si no hay subdomain válido.
 */
export function extractSubdomain(host: string): string | null {
  // Sin host
  if (!host) return null;
  
  // Ignorar localhost
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    return null;
  }
  
  // Ignorar IPs
  if (/^[\d.:]+$/.test(host)) {
    return null;
  }
  
  // Dominios reservados que no son tenants
  const reservedDomains = [
    "api", "www", "admin", "app", "mail", "ftp", "smtp", "dashboard"
  ];
  
  const parts = host.split(".");
  const subdomain = parts[0].toLowerCase();
  
  if (reservedDomains.includes(subdomain)) {
    return null;
  }
  
  return subdomain;
}

// Ejemplos:
// extractSubdomain("acme.coexistance.io") → "acme"
// extractSubdomain("api.coexistance.io") → null (reservado)
// extractSubdomain("beta.api.coexistance.io") → "beta"
// extractSubdomain("localhost:5173") → null
// extractSubdomain("127.0.0.1:3000") → null
