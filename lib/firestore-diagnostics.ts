'use client';

type Metric = 'listener:start' | 'listener:snapshot' | 'listener:stop' | 'request' | 'write';

const enabled = process.env.NODE_ENV === 'development'
  && process.env.NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS === 'true';
const counts = new Map<string, number>();

/** Development-only counters. Never include document data, UIDs, or coordinates. */
export function recordFirestoreDiagnostic(metric: Metric, operation: string, documents?: number) {
  if (!enabled) return;
  const key = `${metric}:${operation}`;
  const invocation = (counts.get(key) ?? 0) + 1;
  counts.set(key, invocation);
  console.debug('[Firestore diagnostics]', { metric, operation, invocation, documents });
}
