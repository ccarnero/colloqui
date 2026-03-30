import { Injectable } from "@nestjs/common";

interface TenantAclEntry {
  subjects: string[];
}

@Injectable()
export class NatsAclManager {
  private readonly tenantAcls = new Map<string, TenantAclEntry>();

  configureTenantAcl(
    tenantId: string,
    allowedSubjects: string[],
  ): void {
    this.tenantAcls.set(tenantId, { subjects: allowedSubjects });
  }

  validatePublish(tenantId: string, subject: string): boolean {
    const entry = this.tenantAcls.get(tenantId);
    if (!entry) return false;
    return entry.subjects.some((pattern) => {
      if (pattern.endsWith(".>")) {
        const prefix = pattern.slice(0, -2);
        return subject === prefix || subject.startsWith(prefix + ".");
      }
      if (pattern.endsWith(".*")) {
        const prefix = pattern.slice(0, -2);
        const rest = subject.slice(prefix.length);
        return (
          subject.startsWith(prefix) &&
          rest.startsWith(".") &&
          !rest.slice(1).includes(".")
        );
      }
      return subject === pattern;
    });
  }

  removeTenantAcl(tenantId: string): void {
    this.tenantAcls.delete(tenantId);
  }

  isTenantConfigured(tenantId: string): boolean {
    return this.tenantAcls.has(tenantId);
  }

  getConfiguredTenants(): string[] {
    return Array.from(this.tenantAcls.keys());
  }
}
