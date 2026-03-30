import { Injectable } from "@nestjs/common";
import { createPinoLogger } from "./pino.logger";
import { filterPii } from "./pii-filter";
import { getActiveTraceId } from "@yoizen/observability";
import { randomUUID } from "node:crypto";
import { type Logger as PinoInstance } from "pino";

export enum AuditAction {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
  PUBLISH = "PUBLISH",
  UNPUBLISH = "UNPUBLISH",
  ROTATE = "ROTATE",
  TRIGGER = "TRIGGER",
  ENABLE = "ENABLE",
  DISABLE = "DISABLE",
  DEPLOY = "DEPLOY",
}

export enum AuditResourceType {
  AGENT = "AGENT",
  CREDENTIAL = "CREDENTIAL",
  JOB = "JOB",
  JOB_EXECUTION = "JOB_EXECUTION",
  CONFIG_FILE = "CONFIG_FILE",
}

export interface AuditResource {
  id: string;
  type: AuditResourceType;
  name?: string;
  tenant: string;
}

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AuditEvent {
  id: string;
  action: AuditAction;
  actor_id: string;
  resource: AuditResource;
  changes?: AuditChange[];
  before_state?: Record<string, unknown>;
  after_state?: Record<string, unknown>;
  timestamp: string;
  trace_id: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditContext {
  traceId: string;
  tenantId: string;
  actorId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditLogger {
  private readonly logger: PinoInstance;

  constructor() {
    this.logger = createPinoLogger("yoizenclaw-admin-audit");
  }

  logCreate(
    context: AuditContext,
    resource: AuditResource,
    afterState?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    const event = this.buildEvent(
      AuditAction.CREATE,
      context,
      resource,
      undefined,
      afterState,
      undefined,
      metadata,
    );
    this.emit(event);
  }

  logUpdate(
    context: AuditContext,
    resource: AuditResource,
    changes: AuditChange[],
    beforeState?: Record<string, unknown>,
    afterState?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    const event = this.buildEvent(
      AuditAction.UPDATE,
      context,
      resource,
      beforeState,
      afterState,
      changes,
      metadata,
    );
    this.emit(event);
  }

  logDelete(
    context: AuditContext,
    resource: AuditResource,
    beforeState?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    const event = this.buildEvent(
      AuditAction.DELETE,
      context,
      resource,
      beforeState,
      undefined,
      undefined,
      metadata,
    );
    this.emit(event);
  }

  logPublish(
    context: AuditContext,
    resource: AuditResource,
    afterState?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    const event = this.buildEvent(
      AuditAction.PUBLISH,
      context,
      resource,
      undefined,
      afterState,
      undefined,
      metadata,
    );
    this.emit(event);
  }

  logRotate(
    context: AuditContext,
    resource: AuditResource,
    afterState?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    const event = this.buildEvent(
      AuditAction.ROTATE,
      context,
      resource,
      undefined,
      afterState,
      undefined,
      metadata,
    );
    this.emit(event);
  }

  logTrigger(
    context: AuditContext,
    resource: AuditResource,
    executionId: string,
    payload?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    const mergedMetadata: Record<string, unknown> = {
      ...metadata,
      execution_id: executionId,
    };
    if (payload) {
      mergedMetadata.payload = filterPii(payload);
    }
    const event = this.buildEvent(
      AuditAction.TRIGGER,
      context,
      resource,
      undefined,
      undefined,
      undefined,
      mergedMetadata,
    );
    this.emit(event);
  }

  logEnable(
    context: AuditContext,
    resource: AuditResource,
    afterState?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    const event = this.buildEvent(
      AuditAction.ENABLE,
      context,
      resource,
      undefined,
      afterState,
      undefined,
      metadata,
    );
    this.emit(event);
  }

  logDisable(
    context: AuditContext,
    resource: AuditResource,
    afterState?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    const event = this.buildEvent(
      AuditAction.DISABLE,
      context,
      resource,
      undefined,
      afterState,
      undefined,
      metadata,
    );
    this.emit(event);
  }

  logDeploy(
    context: AuditContext,
    resourceType: AuditResourceType,
    filesDeployed: string[],
    filesDeleted: string[],
    metadata?: Record<string, unknown>,
  ): void {
    const resource: AuditResource = {
      id: "batch",
      type: resourceType,
      tenant: context.tenantId,
    };
    const mergedMetadata: Record<string, unknown> = {
      ...metadata,
      files_deployed: filesDeployed,
      files_deleted: filesDeleted,
    };
    const event = this.buildEvent(
      AuditAction.DEPLOY,
      context,
      resource,
      undefined,
      undefined,
      undefined,
      mergedMetadata,
    );
    this.emit(event);
  }

  private buildEvent(
    action: AuditAction,
    context: AuditContext,
    resource: AuditResource,
    beforeState?: Record<string, unknown>,
    afterState?: Record<string, unknown>,
    changes?: AuditChange[],
    metadata?: Record<string, unknown>,
  ): AuditEvent {
    return {
      id: randomUUID(),
      action,
      actor_id: context.actorId,
      resource,
      changes,
      before_state: beforeState
        ? filterPii(beforeState)
        : undefined,
      after_state: afterState
        ? filterPii(afterState)
        : undefined,
      timestamp: new Date().toISOString(),
      trace_id: context.traceId,
      ip_address: context.ipAddress,
      user_agent: context.userAgent,
      metadata,
    };
  }

  private emit(event: AuditEvent): void {
    setImmediate(() => {
      this.logger.info(
        { audit: event },
        `audit:${event.action}:${event.resource.type}`,
      );
    });
  }
}

export function createSystemAuditContext(
  tenantId: string,
  traceId?: string,
  systemId?: string,
  ipAddress?: string,
  userAgent?: string,
): AuditContext {
  return {
    traceId: traceId ?? getActiveTraceId() ?? randomUUID(),
    tenantId,
    actorId: systemId ?? "admin-service",
    ipAddress,
    userAgent,
  };
}

export function generateTraceId(): string {
  return randomUUID();
}

export function createAuditResource(
  id: string,
  type: AuditResourceType,
  tenant: string,
  name?: string,
): AuditResource {
  return { id, type, tenant, name };
}

export function createAuditChange(
  field: string,
  before: unknown,
  after: unknown,
): AuditChange {
  return { field, before, after };
}
