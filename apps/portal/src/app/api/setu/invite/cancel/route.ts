import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const bodySchema = z.object({
  // The pending co-manager member's mid — what the family members list has. The
  // invite is found by its back-reference (invite.memberMid), so the UI never
  // needs the opaque invite token.
  mid: z.string().min(1),
});

// A family manager cancels a still-pending co-manager invite. Deletes the pending
// member doc (created at invite-send) AND the invite doc together, so no orphan
// remains. The pending member was never added to family.managers and has no
// contactKey, so there is nothing else to unwind. Manager-only (canAccessRoute
// routes /api/setu/invite/cancel to the manager catch-all); the handler also
// binds fid from the session so a manager can only cancel their own invites.
export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');
  if (!role) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (role !== 'family-manager') return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  if (!fid) return NextResponse.json({ error: 'missing-fid' }, { status: 400 });

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const { mid } = parsed.data;

  const db = portalFirestore();
  const memberRef = db.collection('families').doc(fid).collection('members').doc(mid);
  // Find the invite by its back-reference. A single-field where on a
  // (non-group) subcollection uses the automatic index — no declared index.
  const inviteQuery = db.collection('families').doc(fid).collection('invites').where('memberMid', '==', mid).limit(1);

  try {
    await db.runTransaction(async (txn) => {
      // --- READS ---
      const inviteSnap = await txn.get(inviteQuery);
      const inviteDoc = inviteSnap.docs[0];
      if (!inviteDoc) throw new Error('invite-not-found');
      const d = inviteDoc.data() as { acceptedAt?: unknown } | undefined;
      // An accepted invite is a real member now — cancelling is a member removal,
      // a different (guarded) flow. Refuse here.
      if (d?.acceptedAt != null) throw new Error('already-accepted');

      const memberSnap = await txn.get(memberRef);

      // --- WRITES ---
      // Only delete the member if it is still the PENDING invite member — never a
      // member who somehow became active (defensive; accept clears inviteStatus).
      if (memberSnap.exists) {
        const m = memberSnap.data() as { inviteStatus?: unknown } | undefined;
        if (m?.inviteStatus === 'pending') txn.delete(memberRef);
      }
      txn.delete(inviteDoc.ref);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'invite-not-found') return NextResponse.json({ error: 'invite-not-found' }, { status: 404 });
    if (msg === 'already-accepted') return NextResponse.json({ error: 'already-accepted' }, { status: 409 });
    throw err;
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
