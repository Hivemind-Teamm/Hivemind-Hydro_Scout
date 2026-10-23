export function notificationReadKey(kind: 'activity' | 'member', id: string, createdAt?: { toDate?: () => Date } | null) {
  return `${kind}:${id}:${createdAt?.toDate?.().getTime() ?? 0}`;
}

export function parseReadNotifications(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}
