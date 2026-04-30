type AuditServiceConfig = {
  readonly port: number;
};

export const auditServiceConfig: AuditServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
};
