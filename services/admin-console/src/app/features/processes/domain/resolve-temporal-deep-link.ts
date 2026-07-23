// resolve-temporal-deep-link.ts — pure Temporal-UI URL construction,
// EXTRACTED from `message-trace.component.ts`'s `temporalUrl()` (the
// legacy tab's existing, working link) without changing its output (T06 of
// manual-loops/admin-console/console-redesign-trace.md, decision 4:
// "Temporal link uses the existing run/workflow identifiers" — reuse the
// existing construction, don't invent a new one).
//
// Legacy reference (`message-trace.component.ts`, `temporalUrl(v)`,
// verified before extraction):
//   const base = environment.temporalUiBaseUrl;
//   if (!base || !v.temporalWorkflowId) return null;
//   return `${base}/namespaces/${environment.temporalNamespace}/workflows/${encodeURIComponent(v.temporalWorkflowId)}`;
// Same shape below, just taking the base/namespace/workflowId as plain
// arguments (pure function, no Angular `environment` import) so both the
// legacy tab and the shared inspector call the SAME implementation.
export interface IResolveTemporalDeepLinkParams {
  readonly temporalUiBaseUrl: string;
  readonly temporalNamespace: string;
  readonly workflowId: string | null;
}

/**
 * Builds the "Open in Temporal" URL for a Temporal workflow id, or `null`
 * when the base URL isn't configured or no workflow id is available — same
 * "hidden, never a broken link" contract the legacy `temporalUrl()` already
 * had. `null`/empty inputs never leak into the returned string.
 */
export function resolveTemporalDeepLink(
  params: IResolveTemporalDeepLinkParams
): string | null {
  const { temporalUiBaseUrl, temporalNamespace, workflowId } = params;
  if (!temporalUiBaseUrl || !workflowId) {
    return null;
  }
  return `${temporalUiBaseUrl}/namespaces/${temporalNamespace}/workflows/${encodeURIComponent(workflowId)}`;
}
