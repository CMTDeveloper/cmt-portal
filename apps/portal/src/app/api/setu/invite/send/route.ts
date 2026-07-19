import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';;
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { portalEnv } from '@/lib/env';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { setuInviteEmail } from '@/lib/aws/templates/setu-invite-email';
import { allocateMemberPublicIds } from '@/features/setu/ids/public-id-allocator';
import { nextMemberMid } from '@/features/setu/ids/member-mid';


const bodySchema = z.object({
  // The manager names the person they're inviting. REQUIRED: send now creates the
  // co-manager member immediately (inviteStatus:'pending') so the family sees them
  // before they accept, and a member doc must have a non-empty name (MemberDoc
  // read-validation enforces min(1)). The invite modal already collects both.
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().email(),
  relation: z.string().min(1).max(40),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');
  const inviterMid = req.headers.get('x-portal-mid');

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const { email, relation, firstName, lastName } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const env = portalEnv();
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SETU_INVITE_TTL_DAYS * 86400_000);

  const db = portalFirestore();

  // The pending co-manager member created inside the txn needs a 5-digit publicMid.
  // Allocate it BEFORE the txn opens (the allocator runs its own Firestore
  // transaction and Firestore forbids nested transactions).
  const newPublicMid = (await allocateMemberPublicIds(1))[0]!;

  let inviterName: string;
  let familyName: string;

  try {
    await db.runTransaction(async (txn) => {
      const familyRef = db.collection('families').doc(fid);
      const familySnap = await txn.get(familyRef);
      if (!familySnap.exists) {
        throw new Error('family-not-found');
      }
      const familyData = familySnap.data() as { name?: string } | undefined;
      familyName = familyData?.name ?? fid;

      // Reject inviting someone who is already a member of this family. Match the
      // normalized invite email (lowercase/trimmed) against each member's primary
      // email and any altEmails. Scanned in memory from a single subcollection
      // read so no array-contains/composite index is required.
      const membersSnap = await txn.get(
        db.collection('families').doc(fid).collection('members'),
      );
      const isExistingMember = (membersSnap.docs as Array<{ data: () => unknown }>).some((doc) => {
        const m = doc.data() as { email?: string | null; altEmails?: string[] } | undefined;
        const candidates = [m?.email ?? null, ...(m?.altEmails ?? [])];
        return candidates.some(
          (value) => typeof value === 'string' && value.toLowerCase().trim() === normalizedEmail,
        );
      });
      if (isExistingMember) {
        throw new Error('already-member');
      }

      let resolvedInviterName = inviterMid ?? 'A family manager';
      if (inviterMid) {
        const memberRef = db.collection('families').doc(fid).collection('members').doc(inviterMid);
        const memberSnap = await txn.get(memberRef);
        if (memberSnap.exists) {
          const memberData = memberSnap.data() as { displayName?: string; firstName?: string; lastName?: string } | undefined;
          if (memberData?.displayName) {
            resolvedInviterName = memberData.displayName;
          } else if (memberData?.firstName && memberData?.lastName) {
            resolvedInviterName = `${memberData.firstName} ${memberData.lastName}`;
          }
        }
      }
      inviterName = resolvedInviterName;

      // Create the co-manager member NOW (inviteStatus:'pending') so the family
      // sees them on the members list before they accept. It is deliberately NOT
      // added to family.managers and has NO contactKey yet — both happen on accept,
      // which preserves the last-manager count and the anti-theft contactKey check.
      // uid is null until the invitee signs in and accept binds their auth.
      // Collision-free: highest existing suffix + 1, NOT member count (count+1
      // reuses a deleted member's slot and txn.set below would overwrite them —
      // the Rana-family data-loss bug).
      const newMid = nextMemberMid(fid, (membersSnap.docs as Array<{ id: string }>).map((d) => d.id));
      const memberRef = db.collection('families').doc(fid).collection('members').doc(newMid);
      txn.set(memberRef, {
        mid: newMid,
        publicMid: newPublicMid,
        uid: null,
        firstName,
        lastName,
        type: 'Adult',
        gender: 'PreferNotToSay',
        manager: true,
        joinedAt: FieldValue.serverTimestamp(),
        email: normalizedEmail,
        phone: null,
        schoolGrade: null,
        birthMonthYear: null,
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
        inviteStatus: 'pending',
      });

      const inviteRef = db.collection('families').doc(fid).collection('invites').doc(token);
      txn.set(inviteRef, {
        token,
        email: normalizedEmail,
        relation,
        // The invited person's name (manager-provided) — also stored on the member.
        firstName,
        lastName,
        // Links the pending member this invite created, so accept LINKS it (sets
        // uid, adds to managers, writes contactKey) instead of creating a duplicate.
        memberMid: newMid,
        inviterMid: inviterMid ?? null,
        inviterName,
        familyName,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
        acceptedAt: null,
        acceptedByMid: null,
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'family-not-found') {
      return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
    }
    if (msg === 'already-member') {
      return NextResponse.json({ error: 'already-member' }, { status: 409 });
    }
    throw err;
  }

  revalidateTag(`family-${fid}`, 'max');
  const baseUrl = env.NEXT_PUBLIC_PORTAL_BASE_URL ?? '';
  const acceptUrl = `${baseUrl}/invite/${token}`;

  await resolveSender().sendEmail({
    to: normalizedEmail,
    ...setuInviteEmail({ inviterName: inviterName!, familyName: familyName!, relation, acceptUrl }),
  });

  return NextResponse.json({ token }, { status: 201 });
}
