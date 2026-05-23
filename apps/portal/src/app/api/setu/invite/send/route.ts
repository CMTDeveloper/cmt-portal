import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { portalEnv } from '@/lib/env';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { setuInviteEmail } from '@/lib/aws/templates/setu-invite-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
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

  const { email, relation } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const env = portalEnv();
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SETU_INVITE_TTL_DAYS * 86400_000);

  const db = portalFirestore();

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

      const inviteRef = db.collection('families').doc(fid).collection('invites').doc(token);
      txn.set(inviteRef, {
        token,
        email: normalizedEmail,
        relation,
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
    throw err;
  }

  const baseUrl = env.NEXT_PUBLIC_PORTAL_BASE_URL ?? '';
  const acceptUrl = `${baseUrl}/invite/${token}`;

  await resolveSender().sendEmail({
    to: normalizedEmail,
    ...setuInviteEmail({ inviterName: inviterName!, familyName: familyName!, relation, acceptUrl }),
  });

  return NextResponse.json({ token }, { status: 201 });
}
