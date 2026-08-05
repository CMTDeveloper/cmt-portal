import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import { paymentFamilyLabel, buildPaymentMetadata, buildClientReferenceId } from '@cmt/shared-domain/setu';
import { createPadSetupLink } from './stripe-pad-client';
import { configuredMonthlyAmountCAD } from './pledge-amount';
import { portalBaseUrl as trustedPortalBaseUrl } from '@/lib/portal-base-url';

/** Statuses that mean "this family already has a pledge in play". */
const LIVE_STATUSES: readonly PledgeStatus[] = ['started', 'active'];

export type StartPledgeResult =
  | { created: true; pid: string; checkoutUrl: string }
  | { created: false; reason: 'already-started' | 'already-active'; pid: string };

export interface StartPledgeActor {
  fid: string;
  mid: string;
  email: string;
  name: string;
  /**
   * The family's 4-digit public Family ID, for the Stripe metadata a human
   * actually reads. Optional because it is minted lazily at first enrollment;
   * `paymentFamilyLabel` falls back to the internal fid when it is absent.
   */
  // `| undefined` is explicit because `exactOptionalPropertyTypes` is on and the
  // family doc types this as `string | null | undefined`.
  publicFid?: string | null | undefined;
  /**
   * The incoming request, used ONLY to resolve the return origin for Stripe.
   * Optional: without it the origin falls back to the configured env and then to
   * production - never to a relative url, and never to a caller-supplied host
   * (`portalBaseUrl` allowlists the host, so this cannot be redirected offsite).
   */
  req?: Request;
}

/**
 * Begin a monthly pledge: reserve the record, then mint the Stripe-hosted
 * mandate page.
 *
 * ── Ordering is deliberate ──────────────────────────────────────────────────
 * The Firestore doc is created BEFORE the provider call. Minting a hosted
 * session first and writing afterwards would, on a write failure, leave a live
 * setup session at Stripe with nothing in the portal pointing at it - an orphan
 * the reconciler could never find, because reconciliation starts from our own
 * `started` rows.
 *
 * The provider call is deliberately OUTSIDE the transaction: network I/O inside
 * a Firestore transaction can be retried by the SDK, which would mint several
 * hosted sessions for one pledge.
 *
 * ── Why the duplicate check is transactional ────────────────────────────────
 * A double-click is two concurrent requests. Checking for an existing pledge
 * outside a transaction lets both read "none" and both create one, leaving a
 * family with two records and - once both are finalized - potentially two
 * monthly debits.
 *
 * ── Why a `started` pledge blocks a new one ─────────────────────────────────
 * `started` means a hosted session is outstanding and we do not yet know whether
 * a mandate was authorised. Minting a second session then risks TWO authorised
 * mandates. The reconciler resolves every `started` pledge to `active` or
 * `failed` within a day, and a `failed` one does not block, so a family is never
 * permanently locked out - they are asked to wait, not turned away.
 */
export async function startPledge(actor: StartPledgeActor): Promise<StartPledgeResult> {
  const db = portalFirestore();
  const col = db.collection('pledges');
  // Guarded, not a bare Number(): a mistyped env var would otherwise snapshot
  // NaN onto the doc, which Firestore rejects outright - the family would see an
  // opaque failure at the one moment they are trying to give.
  const monthlyAmountCAD = configuredMonthlyAmountCAD();

  const ref = col.doc();
  const pid = ref.id;

  const reserved = await db.runTransaction(async (txn) => {
    // Queried by `fid` ONLY - a single-field equality, which Firestore indexes
    // automatically. Status is filtered in memory: a family has a handful of
    // pledge rows at most, and a second `where` would need a composite index
    // this feature otherwise does not require.
    const existing = await txn.get(col.where('fid', '==', actor.fid));
    for (const d of existing.docs) {
      const status = (d.data() as { status?: PledgeStatus }).status;
      if (status && LIVE_STATUSES.includes(status)) {
        return { blocked: true as const, pid: d.id, status };
      }
    }
    txn.create(ref, {
      pid,
      fid: actor.fid,
      monthlyAmountCAD,
      status: 'started' satisfies PledgeStatus,
      startedAt: new Date(),
      activatedAt: null,
      cancelledAt: null,
      startedByMid: actor.mid,
      setupSessionId: null,
      subscriptionId: null,
      customerId: null,
    });
    return { blocked: false as const, pid };
  });

  if (reserved.blocked) {
    return {
      created: false,
      reason: reserved.status === 'active' ? 'already-active' : 'already-started',
      pid: reserved.pid,
    };
  }

  try {
    const link = await createPadSetupLink({
      customerEmail: actor.email,
      customerName: actor.name,
      // Family FIRST, then the pledge record - the same shape the one-time
      // donation now sends, so one family looks the same on both Stripe paths.
      clientReferenceId: buildClientReferenceId({
        familyLabel: paymentFamilyLabel({ fid: actor.fid, publicFid: actor.publicFid }),
        recordId: pid,
      }),
      successUrl: `${pledgeReturnOrigin(actor.req)}/donate/success?pledge=${encodeURIComponent(pid)}`,
      // ── Cancel returns to the CHOICE, not to the dashboard ─────────────────
      // Vaibhav, 2026-07-29: *"they need to be taken back to options again where
      // they can select donation or pledge"* - and, of this very URL, *"perhaps
      // this needs to be updated where if one clicks cancelled then it resets"*.
      // It pointed at `/family`, which shows Bala Vihar status and no way to
      // choose, so backing out of Stripe left the family looking at a screen
      // with nothing on it to act on.
      //
      // The enroll page IS the reset: it calls `clearAbandonedPledge` on render,
      // which asks Stripe whether the session was ever submitted and clears the
      // record if it was not - so this lands them on the one-time/monthly choice
      // with the abandoned attempt already gone. Cancelling and closing the tab
      // therefore heal by the same path; the difference is only when.
      cancelUrl: `${pledgeReturnOrigin(actor.req)}/family/enroll/bala-vihar`,
      // `fid` is the internal document key and stays put - the pledge record and
      // any support lookup match on it. `familyId` is the human-readable form
      // ("FID-5001") Vaibhav asked for after finding a live Stripe call
      // identified only by "CMT-HTNO0TEG". The donation checkout writes the same
      // pair, so one family looks the same on both payment paths.
      // The SAME helper the one-time donation uses. This path sent no
      // `campaign` and no `source` at all until 2026-08-03, so every live
      // monthly mandate reached CMT's accounting unattributed.
      metadata: buildPaymentMetadata({
        kind: 'pledge',
        fid: actor.fid,
        familyId: paymentFamilyLabel({ fid: actor.fid, publicFid: actor.publicFid }),
        pid,
      }),
    });
    // Only the handles - explicitly named, never a spread of the provider
    // response, so a field we did not ask for cannot land in the document.
    await ref.update({ setupSessionId: link.sessionId, customerId: link.customerId });
    return { created: true, pid, checkoutUrl: link.checkoutUrl };
  } catch (err) {
    // Leaving it `started` would be doubly wrong: the guard above would block
    // every future attempt, and the family's card would claim a gift is being
    // set up when no hosted session was ever created.
    await ref
      .update({ status: 'failed' satisfies PledgeStatus, lastError: String(err) })
      .catch(() => undefined);
    throw err;
  }
}

/**
 * The absolute origin for Stripe's successUrl / cancelUrl.
 *
 * Delegates to `lib/portal-base-url`, which chains configured env -> allowlisted
 * request host -> prod fallback and can NEVER return empty. The previous
 * `(env ?? '')` produced a RELATIVE url ("/donate/success?pledge=...") whenever
 * `NEXT_PUBLIC_PORTAL_BASE_URL` was unset - which is the deliberate state of the
 * Vercel PREVIEW environment, so the whole pledge flow was unusable there
 * (Stripe requires an absolute return url). Threading the request through means
 * a preview deployment returns the family to THAT deployment, not to production.
 */
function pledgeReturnOrigin(req?: Request): string {
  return trustedPortalBaseUrl(req).replace(/\/+$/, '');
}
