import { connection, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

// TEMPORARY — Sentry onboarding verify route. Hit GET /api/debug/sentry-test
// once after deploy to confirm events land in Sentry, then DELETE this file
// and remove '/api/debug/sentry-test' from PUBLIC_ROUTES. It captures an
// intentional error and returns the Sentry event id.
export async function GET() {
  // cacheComponents: opt into per-request dynamic execution so this runs on
  // every hit and is never evaluated during build-time prerendering.
  await connection();

  const eventId = Sentry.captureException(
    new Error('Sentry verify — intentional test error from /api/debug/sentry-test'),
  );

  // Serverless: flush before the function returns/freezes or the event is lost.
  await Sentry.flush(2000);

  return NextResponse.json({ ok: true, eventId }, { status: 200 });
}
