import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/firebase-admin';
import { clearFireIncident, FireClearError } from '@/lib/clear-fire-incident';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== req.nextUrl.origin) return reply({ error: 'Invalid origin.' }, 403);
  const session = req.cookies.get('session')?.value;
  if (!session) return reply({ error: 'Authentication required.' }, 401);
  let id: unknown;
  try { id = (await req.json()).id; } catch { return reply({ error: 'Invalid request.' }, 400); }
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{20}$/.test(id)) return reply({ error: 'Invalid incident.' }, 400);
  try {
    const app = adminApp();
    const decoded = await getAuth(app).verifySessionCookie(session, true);
    return reply({ ok: true, ...await clearFireIncident(getFirestore(app), decoded.uid, id) });
  } catch (error) {
    if (error instanceof FireClearError) return reply({ error: error.message }, error.status);
    const code = (error as { code?: string })?.code;
    if (['auth/session-cookie-expired', 'auth/session-cookie-revoked', 'auth/invalid-session-cookie', 'auth/argument-error', 'auth/user-disabled', 'auth/user-not-found'].includes(code || '')) return reply({ error: 'Sign in again.' }, 401);
    console.error('Could not clear incident and end responses:', error);
    return reply({ error: 'Could not clear the incident. Please try again.' }, 503);
  }
}
