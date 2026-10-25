export function lastLoggedInLabel(value: Date | null | undefined) {
  if (!value || !Number.isFinite(value.getTime())) return 'Never logged in';
  const date = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
  }).format(value);
  return `Last logged in ${date} (PHT)`;
}

export function accountLoginStatus(value: unknown, now = Date.now()) {
  let lastLoginAt: Date | null = null;
  try {
    if (value instanceof Date) lastLoginAt = value;
    else if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') lastLoginAt = value.toDate();
    else if (typeof value === 'string' || typeof value === 'number') lastLoginAt = new Date(value);
  } catch { /* Invalid historical timestamps are not activity evidence. */ }
  if (!(lastLoginAt instanceof Date) || !Number.isFinite(lastLoginAt.getTime())) {
    return { lastLoginAt: null, label: value == null ? 'Never logged in' : 'Login time unavailable', lastLoginLabel: value == null ? 'Never logged in' : 'Not recorded' };
  }
  const age = now - lastLoginAt.getTime();
  // Tolerate small client/server clock differences without treating arbitrary
  // future timestamps as evidence of a recent login.
  if (age < -60_000) return { lastLoginAt, label: 'Login time unavailable', lastLoginLabel: 'Check account timestamp' };
  const minutes = Math.floor(Math.max(0, age) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const lastLoginLabel = minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago`
    : hours < 24 ? `${hours} hr${hours === 1 ? '' : 's'} ago`
      : days < 30 ? `${days} day${days === 1 ? '' : 's'} ago`
        : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(lastLoginAt);
  return { lastLoginAt, label: lastLoggedInLabel(lastLoginAt), lastLoginLabel };
}
