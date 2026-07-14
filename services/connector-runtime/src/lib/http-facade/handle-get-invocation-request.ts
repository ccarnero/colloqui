// Orchestrates `GET /invocations/:invocationId` (the async invoke polling
// fallback, `manual-loops/connector-invoke-api.md` T05): tenant guard, then
// a tenant-scoped Redis lookup — WITHOUT touching `Bun.serve`/`Request`/
// `Response` directly, same shape as `handle-invoke-request.ts`.
//
// TENANT ISOLATION: `getInvocationRecord` is called with the CALLER's
// tenant (from the `x-yoizen-tenant` header), and the underlying store key
// is `invocation:<tenantId>:<invocationId>` (`build-invocation-redis-key.ts`).
// A caller polling another tenant's invocationId can never read it — the
// key simply does not exist under their tenant, so it reads as `expired`
// exactly like an unknown/expired id (no separate tenant-mismatch branch to
// forget).

import { TENANT_HEADER } from "@yoizen/shared";
import type { GetInvocationRecord } from "../invoke-consumer/park-invocation-result";
import { checkTenantHeader } from "./check-tenant-header";

export interface HandleGetInvocationRequestDeps {
  readonly tenantHeader: string | null;
  readonly invocationId: string;
  readonly getInvocationRecord: GetInvocationRecord;
  readonly log?: (message: string) => void;
  readonly warn?: (message: string) => void;
}

export type HandleGetInvocationRequestResult =
  | { readonly status: 400; readonly body: { readonly error: string } }
  | {
      readonly status: 200;
      readonly body: {
        readonly invocationId: string;
        readonly status: "pending";
      };
    }
  | {
      readonly status: 200;
      readonly body: {
        readonly invocationId: string;
        readonly status: "completed";
        readonly outcome: "ok" | "error";
        readonly result?: unknown;
        readonly error?: { readonly kind: string; readonly message: string };
      };
    }
  | {
      readonly status: 404;
      readonly body: {
        readonly invocationId: string;
        readonly status: "expired";
      };
    };

export async function handleGetInvocationRequest(
  deps: HandleGetInvocationRequestDeps
): Promise<HandleGetInvocationRequestResult> {
  const log = deps.log ?? ((): void => {});
  const warn = deps.warn ?? ((): void => {});

  const tenantGuard = checkTenantHeader(deps.tenantHeader);
  if (!tenantGuard.ok) {
    warn(
      `invoke GET invocations REJECTED invocationId=${deps.invocationId} — missing ${TENANT_HEADER} header`
    );
    return { status: tenantGuard.status, body: tenantGuard.body };
  }
  const { tenantId } = tenantGuard;

  const record = await deps.getInvocationRecord(tenantId, deps.invocationId);

  if (!record) {
    log(
      `invoke GET invocations invocationId=${deps.invocationId} tenant=${tenantId} — expired/unknown`
    );
    return {
      status: 404,
      body: { invocationId: deps.invocationId, status: "expired" },
    };
  }

  if (record.status === "pending") {
    log(
      `invoke GET invocations invocationId=${deps.invocationId} tenant=${tenantId} — pending`
    );
    return {
      status: 200,
      body: { invocationId: deps.invocationId, status: "pending" },
    };
  }

  log(
    `invoke GET invocations invocationId=${deps.invocationId} tenant=${tenantId} — completed outcome=${record.outcome}`
  );
  return {
    status: 200,
    body: {
      invocationId: deps.invocationId,
      status: "completed",
      outcome: record.outcome,
      ...(record.result !== undefined && { result: record.result }),
      ...(record.error !== undefined && { error: record.error }),
    },
  };
}
