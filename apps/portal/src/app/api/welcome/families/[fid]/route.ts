import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import {
  isWelcomeTeam,
  FamilyAddressSchema,
  FamilyEmergencyContactSchema,
} from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { writeAuditLog } from '@/features/setu/audit/audit-log';

type RouteContext = { params: Promise<{ fid: string }> };

/**
 * Family-level fields only. `.strict()` so a patch can never reach `managers`,
 * `fid` or `legacyFid`: managers is maintained by the member routes, whose
 * last-manager guard rewriting it here would route around, and the two ids are
 * the family's identity.
 */
const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    familyAddress: FamilyAddressSchema.optional(),
    familyEmergencyContact: FamilyEmergencyContactSchema.nullable().optional(),
  })
  .strict();

/**
 * Staff edit of one family's own fields.
 *
 * Wrapped in a transaction purely so the audit row commits with the change:
 * `writeAuditLog` takes the caller's transaction so a rejected write leaves no
 * row and a committed one can never lack it.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Authority from the session, target from the route. Never mixed.
  const { fid } = await ctx.params;

  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const db = portalFirestore();
  const actorUid = session.uid;

  try {
    await db.runTransaction(async (txn) => {
      const familyRef = db.collection('families').doc(fid);
      const snap = await txn.get(familyRef);
      if (!snap.exists) {
        throw Object.assign(new Error('not-found'), { code: 'not-found' });
      }

      const existing = (snap.data() ?? {}) as Record<string, unknown>;

      // Only write the keys the caller actually sent, so a location-only patch
      // never wipes the address (same rule as the family's own PATCH route).
      const updates: Record<string, unknown> = { ...data };

      // searchKeys is what welcome-team family search matches on
      // (array-contains). A rename that does not extend it leaves the family
      // unsearchable by the name every screen now shows.
      //
      // Additive on purpose: the array is deduped across the family name AND
      // every member name, so removing the old value can drop a key that a
      // member name also justified. A stale key just means the family is still
      // findable by its previous name, which is the better failure.
      if (typeof data.name === 'string') {
        const keys = Array.isArray(existing['searchKeys']) ? [...(existing['searchKeys'] as string[])] : [];
        const next = data.name.toLowerCase();
        if (!keys.includes(next)) keys.push(next);
        updates['searchKeys'] = keys;
      }

      txn.set(familyRef, updates, { merge: true });

      const before: Record<string, unknown> = {};
      for (const key of Object.keys(updates)) before[key] = existing[key] ?? null;

      writeAuditLog(txn, db, {
        actorUid,
        actorMid: session.mid,
        actorRole: session.role,
        action: 'family.update',
        fid,
        mid: null,
        before,
        after: updates,
      });
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'not-found') {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    throw err;
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
