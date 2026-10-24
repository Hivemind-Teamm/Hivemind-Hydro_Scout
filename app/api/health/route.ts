// app/api/health/route.ts
//
// Unauthenticated deployment check: can this server verify logins?
// 200 when Firebase Admin loads and its credential works, 503 otherwise.
// Responds with pass/fail flags only; error details go to the server log.
// Check it on every Vercel deployment (preview or production) that touches
// auth, server routes, dependencies, the Node.js version or env vars.

import { NextResponse } from "next/server";

export async function GET() {
  const checks = { adminModules: false, credential: false };

  try {
    await import('firebase-admin/auth');
    await import('firebase-admin/firestore');
    checks.adminModules = true;

    const { adminApp } = await import('@/lib/firebase-admin');
    // Emulator-mode apps have no credential; production apps always do.
    await adminApp().options.credential?.getAccessToken();
    checks.credential = true;
  } catch (err) {
    console.error('[health] Firebase Admin check failed:', err);
  }

  const ok = checks.adminModules && checks.credential;
  return NextResponse.json(
    { ok, node: process.versions.node, checks },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
