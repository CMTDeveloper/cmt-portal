import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { assertNotLastManager, LastManagerError } from '@/features/setu/members';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';


type RouteContext = { params: Promise<{ mid: string }> };

// Immutable fields — cannot be patched by anyone
const patchSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    type: z.enum(['Adult', 'Child']).optional(),
    gender: z.enum(['Male', 'Female', 'PreferNotToSay']).optional(),
    manager: z.boolean().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().min(7).nullable().optional(),
    schoolGrade: z.string().nullable().optional(),
    birthMonthYear: z.string().nullable().optional(),
    birthMonth: z.number().int().min(1).max(12).nullable().optional(),
    foodAllergies: z.string().nullable().optional(),
    volunteeringSkills: z.array(z.string()).optional(),
    emergencyContacts: z
      .tuple([
        z.object({ relation: z.string(), phone: z.string(), email: z.string() }).nullable(),
        z.object({ relation: z.string(), phone: z.string(), email: z.string() }).nullable(),
      ])
      .optional(),
  })
  .strict(); // rejects mid, uid, joinedAt

export async function PATCH(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');
  const callerMid = req.headers.get('x-portal-mid');
  const { mid: targetMid } = await ctx.params;

  if (!role || !callerMid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const isManager = role === 'family-manager';
  const isSelfEdit = callerMid === targetMid;

  // Non-managers can only edit themselves
  if (!isManager && !isSelfEdit) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Only managers can change manager flag
  if ('manager' in data && !isManager) {
    return NextResponse.json({ error: 'manager-flag-requires-manager-role' }, { status: 403 });
  }

  const db = portalFirestore();

  try {
    await db.runTransaction(async (txn) => {
      const familyRef = db.collection('families').doc(fid);
      const memberRef = db.collection('families').doc(fid).collection('members').doc(targetMid);

      const [familySnap, memberSnap] = await Promise.all([
        txn.get(familyRef),
        txn.get(memberRef),
      ]);

      if (!memberSnap.exists) {
        throw Object.assign(new Error('not-found'), { code: 'not-found' });
      }

      const memberData = memberSnap.data() as { mid: string; type: 'Adult' | 'Child'; manager: boolean; email: string | null; phone: string | null };

      // Security: ensure member belongs to caller's family by checking document path prefix
      if (!memberData.mid.startsWith(fid + '-')) {
        throw Object.assign(new Error('cross-family'), { code: 'cross-family' });
      }

      // Adults must keep at least one volunteering skill (issue #10). Only
      // enforced when the patch actually touches volunteeringSkills, so editing
      // other fields of an adult with legacy-empty skills still works. Adult-ness
      // comes from the patch's `type` when provided, else the existing doc.
      if ('volunteeringSkills' in data) {
        const willBeAdult = data.type ? data.type === 'Adult' : memberData.type === 'Adult';
        if (willBeAdult && (data.volunteeringSkills?.length ?? 0) < 1) {
          throw Object.assign(new Error('skills-required'), { code: 'skills-required' });
        }
      }

      // Guard against demoting the last manager
      if (data.manager === false && memberData.manager === true && familySnap.exists) {
        const familyData = familySnap.data() as { managers: string[] };
        assertNotLastManager(familyData, targetMid, 'demote');
      }

      // Before any contactKey writes, verify the new email/phone hash isn't
      // already owned by a different family. Without this, a PATCH could
      // silently overwrite another family's contactKey pointer (theft).
      const newEmail = 'email' in data ? data.email ?? null : null;
      const newPhone = 'phone' in data ? data.phone ?? null : null;
      const newEmailHash = newEmail && newEmail !== memberData.email ? hashContactKey('email', newEmail) : null;
      const newPhoneHash = newPhone && newPhone !== memberData.phone ? hashContactKey('phone', newPhone) : null;
      const [newEmailSnap, newPhoneSnap] = await Promise.all([
        newEmailHash ? txn.get(db.collection('contactKeys').doc(newEmailHash)) : Promise.resolve(null),
        newPhoneHash ? txn.get(db.collection('contactKeys').doc(newPhoneHash)) : Promise.resolve(null),
      ]);
      if (newEmailSnap && newEmailSnap.exists) {
        const existing = newEmailSnap.data() as { fid?: string } | undefined;
        if (existing?.fid && existing.fid !== fid) {
          throw Object.assign(new Error('contact-conflict:email'), { code: 'contact-conflict' });
        }
      }
      if (newPhoneSnap && newPhoneSnap.exists) {
        const existing = newPhoneSnap.data() as { fid?: string } | undefined;
        if (existing?.fid && existing.fid !== fid) {
          throw Object.assign(new Error('contact-conflict:phone'), { code: 'contact-conflict' });
        }
      }

      // Build update payload — only include fields that were provided
      const updates: Record<string, unknown> = { ...data };

      // Update managers array on family doc if manager flag is changing
      if (familySnap.exists && 'manager' in data) {
        const familyData = familySnap.data() as { managers: string[] };
        let managers = [...(familyData.managers ?? [])];
        if (data.manager === true && !managers.includes(targetMid)) {
          managers.push(targetMid);
        } else if (data.manager === false) {
          managers = managers.filter((m) => m !== targetMid);
        }
        txn.set(familyRef, { managers }, { merge: true });
      }

      // Handle contactKey mutations for email/phone changes
      if ('email' in data) {
        const oldEmail = memberData.email;
        const newEmail = data.email ?? null;
        if (oldEmail && oldEmail !== newEmail) {
          const oldHash = hashContactKey('email', oldEmail);
          txn.delete(db.collection('contactKeys').doc(oldHash));
        }
        if (newEmail) {
          const newHash = hashContactKey('email', newEmail);
          txn.set(db.collection('contactKeys').doc(newHash), {
            contactKey: newHash,
            type: 'email',
            fid,
            mid: targetMid,
          });
        }
      }

      if ('phone' in data) {
        const oldPhone = memberData.phone;
        const newPhone = data.phone ?? null;
        if (oldPhone && oldPhone !== newPhone) {
          const oldHash = hashContactKey('phone', oldPhone);
          txn.delete(db.collection('contactKeys').doc(oldHash));
        }
        if (newPhone) {
          const newHash = hashContactKey('phone', newPhone);
          txn.set(db.collection('contactKeys').doc(newHash), {
            contactKey: newHash,
            type: 'phone',
            fid,
            mid: targetMid,
          });
        }
      }

      txn.set(memberRef, updates, { merge: true });
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'not-found') {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    if (code === 'cross-family') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (code === 'skills-required') {
      return NextResponse.json({ error: 'skills-required' }, { status: 400 });
    }
    if (code === 'contact-conflict') {
      const msg = err instanceof Error ? err.message : '';
      return NextResponse.json(
        { error: 'contact-already-registered', field: msg.split(':')[1] },
        { status: 409 },
      );
    }
    if (err instanceof LastManagerError) {
      return NextResponse.json({ error: 'last-manager' }, { status: 409 });
    }
    throw err;
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = _req.headers.get('x-portal-role');
  const fid = _req.headers.get('x-portal-fid');
  const { mid: targetMid } = await ctx.params;

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const db = portalFirestore();

  try {
    await db.runTransaction(async (txn) => {
      const familyRef = db.collection('families').doc(fid);
      const memberRef = db.collection('families').doc(fid).collection('members').doc(targetMid);

      const [familySnap, memberSnap] = await Promise.all([
        txn.get(familyRef),
        txn.get(memberRef),
      ]);

      if (!memberSnap.exists) {
        throw Object.assign(new Error('not-found'), { code: 'not-found' });
      }

      const memberData = memberSnap.data() as {
        manager: boolean;
        email: string | null;
        phone: string | null;
      };
      const familyData = familySnap.data() as { managers: string[]; fid: string };

      // Guard: cannot remove the last manager
      if (memberData.manager) {
        assertNotLastManager(familyData, targetMid, 'remove');
      }

      // Remove contactKey docs
      if (memberData.email) {
        const hash = hashContactKey('email', memberData.email);
        txn.delete(db.collection('contactKeys').doc(hash));
      }
      if (memberData.phone) {
        const hash = hashContactKey('phone', memberData.phone);
        txn.delete(db.collection('contactKeys').doc(hash));
      }

      // Update managers array on family doc if the deleted member was a manager
      if (memberData.manager && familySnap.exists) {
        const updatedManagers = (familyData.managers ?? []).filter((m) => m !== targetMid);
        txn.set(familyRef, { managers: updatedManagers }, { merge: true });
      }

      txn.delete(memberRef);
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'not-found') {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    if (err instanceof LastManagerError) {
      return NextResponse.json({ error: 'last-manager' }, { status: 409 });
    }
    throw err;
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
