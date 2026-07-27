import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { reconcilePledges } from '@/features/setu/pledges/reconcile-pledges';
import { flags } from '@/lib/flags';

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

/**
 * The daily reconciler: finish the pledges whose browser died mid-flow.
 *
 * Daily is enough - a pre-authorized debit settles in days, not minutes. The
 * cost of being a day late is a family briefly seeing "we're setting up your
 * monthly gift"; the cost of never running is a live mandate at Stripe with no
 * subscription behind it, forever.
 *
 * Gated on the SAME flag as the family surfaces. `/pad/*` is Stripe TEST mode
 * until that flag is flipped, so a cron that called the provider while the
 * feature is dark would be acting on pledges that exist only because someone was
 * testing. It returns 200 with `disabled: true` rather than an error, so a
 * disabled run is visibly distinct from a broken one in the Vercel cron log.
 */
async function handle(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!flags.setuPledge) {
    return NextResponse.json(
      { success: true, disabled: true, scanned: 0, activated: 0, failed: 0, processing: 0, errored: 0, stale: 0, unverified: 0 },
      { status: 200 },
    );
  }

  try {
    const result = await reconcilePledges();
    // `stale` and `unverified` are reduced to COUNTS here. The pids are in the
    // server log for a human; a cron response body is not the place to
    // enumerate which families are stuck.
    return NextResponse.json(
      { success: true, ...result, stale: result.stale.length, unverified: result.unverified.length },
      { status: 200 },
    );
  } catch (err) {
    // 500, never a quiet success. A cron reporting {success:true} while throwing
    // would be invisible, and the orphan mandates it exists to repair would pile
    // up unnoticed - which is the exact failure this whole task guards against.
    console.error('[pledge] reconcile run failed', err);
    return NextResponse.json({ error: 'reconcile-failed' }, { status: 500 });
  }
}

// Vercel Cron triggers with an HTTP GET; POST is kept for manual invocation.
// Exporting only POST silently 405'd every scheduled run of an earlier cron.
export const GET = handle;
export const POST = handle;
