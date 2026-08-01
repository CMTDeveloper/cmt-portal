import { NextResponse } from 'next/server';
import { isSetuManager } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { selectBalaViharEnrollment } from '@/app/family/_helpers/select-bv-enrollment';
import { startPledge } from '@/features/setu/pledges/start-pledge';
import { clearAbandonedPledge } from '@/features/setu/pledges/clear-abandoned-pledge';
import { buildPledgeCustomerName } from '@/features/setu/pledges/pledge-customer-name';
import { flags } from '@/lib/flags';

/**
 * POST /api/pledges/start - begin a monthly pledge and hand back the
 * Stripe-hosted mandate URL.
 *
 * Deliberately OUTSIDE `/api/setu/*`: that prefix's catch-all grants
 * welcome-team and admin by default (`can-access-route.ts`), and a route that
 * creates a recurring financial commitment must never inherit authorization by
 * accident. `/api/pledges/*` has its own explicit rule.
 *
 * `fid` comes from the SESSION and never from the body - otherwise any manager
 * could start a pledge against another family.
 */
export async function POST(req: Request) {
  // 404, not 403: with the feature dark, the route should look absent rather
  // than merely forbidden.
  if (!flags.setuPledge) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ error: 'no-family' }, { status: 401 });
  // Belt and braces with the middleware rule: canAccessRoute is the gate, this
  // is the in-handler check the repo requires for every privileged route.
  if (!isSetuManager(session)) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!session.mid) return NextResponse.json({ error: 'no-member' }, { status: 401 });
  if (!session.email) {
    // The hosted page needs somewhere to send the mandate confirmation.
    return NextResponse.json({ error: 'no-email' }, { status: 400 });
  }

  const fam = await getFamilyByFid(session.fid);
  if (!fam) return NextResponse.json({ error: 'family-not-found' }, { status: 404 });

  // ── The mandate must have something to fund ────────────────────────────────
  //
  // 🔴 Reported 2026-07-28: a UAT family with ZERO children held a `started`
  // pledge. Every check above passes for them - they are a manager, with an
  // email, and their family exists - and none of those asks the only question
  // that matters: is there a Bala Vihar contribution to spread? The enroll page
  // was offering "Give $51 monthly" beside "Add a child to enroll", so a bank
  // mandate was authorised for a family that could not join the program at all.
  //
  // Enforced HERE and not only in the UI for the reason the double-charge
  // taught: three screens can reach this route, each would re-implement the
  // rule, and one of them would be missed. Once a mandate exists the portal has
  // no way to undo it - there is no cancel endpoint on the payment service - so
  // the refusal has to come before the hosted page, never after.
  //
  // Nobody is turned away: enrollment is free, and `DonationChoice` enrols the
  // family FIRST and then starts the pledge, so the intended flow satisfies
  // this by the time it arrives.
  const enrollments = await getEnrollments(session.fid);
  if (!selectBalaViharEnrollment(enrollments)) {
    // 409, not 403: the family is permitted to do this, just not yet.
    return NextResponse.json({ error: 'enrollment-required' }, { status: 409 });
  }

  // ── An attempt they never finished must not block the next one ────────────
  // Vaibhav, 2026-07-29: the family "start[s] the donation process again and
  // complete[s] on their own since this is complete self serve". Without this a
  // retry hits `already-started` from a session Stripe says was never submitted.
  // Fails CLOSED - only clears what the provider confirms was never submitted,
  // so a real mandate still blocks a second one.
  //
  // `notify: false` is the ONE place that suppresses the abandonment letter.
  // The family is starting payment again in this very request, so "your donation
  // is not finished" would be wrong on arrival - and worse, it would burn the
  // 7-day cooldown that the real abandonment needs later.
  await clearAbandonedPledge(session.fid, { notify: false });

  try {
    const result = await startPledge({
      fid: session.fid,
      mid: session.mid,
      email: session.email,
      // The PERSON who authorised the mandate, plus the public Family ID -
      // e.g. "Vaibhav Rana (5001)". Was `fam.family.name`, which put the
      // derived "Rana family" on the live Stripe Customer beside the manager's
      // personal email. See buildPledgeCustomerName for why the person is the
      // correct value on a pre-authorized debit.
      name: buildPledgeCustomerName({
        members: fam.members,
        mid: session.mid,
        publicFid: fam.family.publicFid,
        familyName: fam.family.name,
      }),
      // So a preview deployment returns the family to ITSELF after the mandate,
      // instead of to production (or, before this, to a relative url).
      req,
    });
    if (!result.created) {
      // 409, not 200: the caller asked to create something and nothing was
      // created. The UI shows the existing state rather than a new link.
      return NextResponse.json({ error: result.reason, pid: result.pid }, { status: 409 });
    }
    return NextResponse.json({ pid: result.pid, checkoutUrl: result.checkoutUrl }, { status: 201 });
  } catch {
    // The provider error itself is recorded on the pledge doc; never echo it to
    // the client, and never log a body that could carry provider detail.
    return NextResponse.json({ error: 'provider-unavailable' }, { status: 503 });
  }
}
