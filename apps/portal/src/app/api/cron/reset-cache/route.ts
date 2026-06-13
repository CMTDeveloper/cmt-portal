import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';


function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return false;
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Portal doesn't use Redis; this endpoint exists for parity and future use.
  return NextResponse.json({ success: true, cleared: 0 }, { status: 200 });
}

// Vercel cron triggers with an HTTP GET (vercel.com/docs/cron-jobs); POST is
// kept for manual invocation (`curl -X POST -H "Authorization: Bearer $CRON_SECRET"`).
// Both share the same handler — exporting only POST silently 405'd every
// scheduled run.
export const GET = handle;
export const POST = handle;
