import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSetuManager } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { finalizePledge } from '@/features/setu/pledges/finalize-pledge';
import { flags } from '@/lib/flags';

/**
 * POST /api/pledges/finalize - called when the family returns from the
 * Stripe-hosted mandate page.
 *
 * The body carries ONLY a pid. `.strict()` so an extra key - `status`,
 * `subscriptionId`, anything that looks like it might steer the outcome - is a
 * 400 rather than silently ignored. The outcome itself is derived entirely from
 * what the provider says; there is no field a caller could set to make a pledge
 * active.
 */
const BodySchema = z.object({ pid: z.string().min(1) }).strict();

export async function POST(req: Request) {
  if (!flags.setuPledge) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ error: 'no-family' }, { status: 401 });
  if (!isSetuManager(session)) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  try {
    // fid from the SESSION - knowing a pid is not enough to drive another
    // family's pledge to a terminal state.
    const out = await finalizePledge({ pid: parsed.data.pid, fid: session.fid });
    switch (out.state) {
      case 'not-found':
        return NextResponse.json({ error: 'not-found' }, { status: 404 });
      case 'not-yours':
        // 404 rather than 403: a pid that is not yours should be
        // indistinguishable from one that does not exist.
        return NextResponse.json({ error: 'not-found' }, { status: 404 });
      default:
        return NextResponse.json({ state: out.state }, { status: 200 });
    }
  } catch {
    return NextResponse.json({ error: 'provider-unavailable' }, { status: 503 });
  }
}
