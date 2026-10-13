import type { Timestamp } from 'firebase/firestore';

export function logFirestoreLatency(
  collectionName: string,
  documentId: string,
  writeTimestamp: Timestamp | null | undefined,
  receivedAtMs: number,
): void {
  if (!writeTimestamp || typeof writeTimestamp.toMillis !== 'function') return;

  const writtenAtMs = writeTimestamp.toMillis();
  const latencyMs = receivedAtMs - writtenAtMs;

  console.info('[Hydro-Scout QA] Firestore latency', {
    collection: collectionName,
    documentId,
    writtenAt: new Date(writtenAtMs).toISOString(),
    receivedAt: new Date(receivedAtMs).toISOString(),
    latencyMs,
  });
}

export function logFirestoreError(operation: string, error: unknown): void {
  const details = error instanceof Error ? error : new Error(String(error));
  const code = 'code' in details ? String(details.code) : 'unknown';

  console.error('[Hydro-Scout QA] Firestore error', {
    timestamp: new Date().toISOString(),
    operation,
    code,
    message: details.message,
  });
}
