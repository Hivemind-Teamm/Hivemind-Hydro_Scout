// Account Center "Change Password" rules and error text.
//
// Firebase only lets a user change their password shortly after signing in
// (auth/requires-recent-login), and this app keeps people signed in for days.
// So the form asks for the current password and re-authenticates first.

export interface PasswordChangeInput {
  current: string;
  next: string;
  retype: string;
}

// Firebase Auth's own minimum.
export const MIN_PASSWORD_LENGTH = 6;

/** The first problem with the form, or null when it can be submitted. */
export function passwordChangeProblem({ current, next, retype }: PasswordChangeInput): string | null {
  if (!current) return 'Enter your current password.';
  if (next.length < MIN_PASSWORD_LENGTH) return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (next === current) return 'New password must be different from your current one.';
  if (next !== retype) return 'New passwords do not match.';
  return null;
}

const MESSAGES: Record<string, string> = {
  'auth/wrong-password': 'Current password is incorrect.',
  'auth/invalid-credential': 'Current password is incorrect.',
  'auth/invalid-login-credentials': 'Current password is incorrect.',
  'auth/user-mismatch': 'Current password is incorrect.',
  'auth/weak-password': `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`,
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/requires-recent-login': 'Please sign out, sign in again, then change your password.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-token-expired': 'Your sign-in expired. Sign in again, then change your password.',
};

/** Readable text for a failed change; never the bare "Error" Firebase messages reduce to. */
export function passwordChangeError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (MESSAGES[code]) return MESSAGES[code];
  // Project password policies explain themselves, e.g. "Missing password requirements: [...]".
  if (code === 'auth/password-does-not-meet-requirements' && error instanceof Error) {
    return error.message.replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]*\)\.?$/, '');
  }
  return code ? `Couldn't change the password (${code}). Try again.` : "Couldn't change the password. Try again.";
}
