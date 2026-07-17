// Server-side default methods a registered route falls back to when the
// manifest/live route omits `methods` — mirrors `RoutesService.create`'s own
// default (see `services/registry-service/src/modules/routes/routes.service.ts`).
// Shared between the plan-phase diff (`comparable-fields.ts`) and the
// apply-phase writer (`registry-services-writer.ts`) so both sides normalize
// against the exact same default.
export const DEFAULT_ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
