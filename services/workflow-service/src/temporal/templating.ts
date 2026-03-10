import type { WorkflowExecutionContext } from '@yoizen/shared';

const TEMPLATE_RE = /\{\{(.+?)\}\}/g;

function resolvePath(context: WorkflowExecutionContext, path: string): unknown {
  const segments = path.trim().split('.');
  let current: unknown = context;
  for (let i = 0; i < segments.length; i++) {
    if (current == null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[segments[i]];
  }
  return current ?? '';
}

export function resolveTemplates<T>(
  value: T,
  context: WorkflowExecutionContext,
): T {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_RE, (_, path: string) =>
      String(resolvePath(context, path)),
    ) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplates(v, context)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (let i = 0; i < entries.length; i++) {
      out[entries[i][0]] = resolveTemplates(entries[i][1], context);
    }
    return out as T;
  }

  return value;
}
