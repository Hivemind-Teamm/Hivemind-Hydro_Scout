import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/firebase-admin';
import {
  claimHydrant,
  HydrantOccupancyError,
} from '@/lib/hydrant-occupancy-service';

export const runtime = 'nodejs';

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });

export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== req.nextUrl.origin) {
    return reply({ error: 'Invalid origin.' }, 403);
  }

  const session = req.cookies.get('session')?.value;

  if (!session) {
    return reply({ error: 'Authentication required.' }, 401);
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Invalid request.' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply({ error: 'Invalid request.' }, 400);
  }

  const { hydrantId, firePinId } = body as Record<string, unknown>;

  if (
    typeof hydrantId !== 'string' ||
    !/^HYD-[0-9]{3,}$/.test(hydrantId) ||
    typeof firePinId !== 'string' ||
    !/^[A-Za-z0-9]{20}$/.test(firePinId)
  ) {
    return reply({ error: 'Invalid hydrant or incident ID.' }, 400);
  }

  try {
    const app = adminApp();

    const decoded = await getAuth(app).verifySessionCookie(
      session,
      true,
    );

    const result = await claimHydrant(
      getFirestore(app),
      decoded.uid,
      hydrantId,
      firePinId,
    );

    return reply({ ok: true, ...result });
  } catch (error) {
    if (error instanceof HydrantOccupancyError) {
      return reply({ error: error.message }, error.status);
    }

    const code = (error as { code?: string })?.code;

    if (
      [
        'auth/session-cookie-expired',
        'auth/session-cookie-revoked',
        'auth/invalid-session-cookie',
        'auth/argument-error',
        'auth/user-disabled',
        'auth/user-not-found',
      ].includes(code || '')
    ) {
      return reply({ error: 'Sign in again.' }, 401);
    }

    console.error('Could not claim hydrant:', error);

    return reply(
      { error: 'Could not claim hydrant. Please try again.' },
      503,
    );
  }
}
