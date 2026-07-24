import 'server-only';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import type { GrantableRole, SevakRow } from '@cmt/shared-domain';
import {
  addCapability,
  removeCapability,
  hasCapability,
  type ClaimsShape,
  type Capability,
} from '@/lib/auth/role-claims';
import { findSetuFamilyByContact } from './find-family-by-contact';
import { addMemberRole, removeMemberRole, listMembersWithRole } from './member-roles';
import { revokeMemberSessions, revokeUidSessions } from './revoke-sessions';

/**
 * Dual-path role management, extracted from scripts/grant-admin.ts and
 * generalized from the hardcoded 'admin' to any GrantableRole. Both the CLI
 * and the /api/admin/users routes call these so the grant/revoke routing
 * stays identical everywhere.
 *
 * Family members → roleAssignments/{mid} (mid-keyed, applies across the
 *   person's email + phone auth uids).
 * Non-family CMT sevaks → legacy auth-claim path keyed on the canonical-form
 *   uid for the contact. The contact must already be a registered portal user
 *   (an auth user exists at that uid); grantRole throws `registered-user-required`
 *   rather than fabricating one, because /api/setu/register would later replace
 *   any pre-seeded claim on that uid at first family registration.
 */

function detectType(c: string): 'email' | 'phone' {
  return c.includes('@') ? 'email' : 'phone';
}

function uidOf(type: 'email' | 'phone', value: string): string {
  // Same canonicalization as verify-code so legacy auth-claim grants land on
  // the uid that OTP sign-in will create / look up.
  return sha256Hex(normalizeContactForKey(type, value));
}

function registeredUserRequiredError(): Error {
  return Object.assign(new Error('registered-user-required'), {
    code: 'registered-user-required',
  });
}

export interface GrantResult {
  path: 'roleAssignments' | 'auth-claim';
  mid: string | null;
  fid: string | null;
  uid: string | null;
}

export async function grantRole(args: {
  contact: string;
  role: GrantableRole;
}): Promise<GrantResult> {
  const type = detectType(args.contact);
  const result = await findSetuFamilyByContact(type, args.contact);

  if (result.source === 'setu' && result.fid && result.mid) {
    await addMemberRole({
      mid: result.mid,
      fid: result.fid,
      role: args.role,
      grantedVia: args.contact,
    });
    return { path: 'roleAssignments', mid: result.mid, fid: result.fid, uid: null };
  }

  // Non-family → auth claim on the canonical uid.
  const auth = portalAuth();
  const uid = uidOf(type, args.contact);
  let existing: ClaimsShape | null = null;
  try {
    existing = ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      throw registeredUserRequiredError();
    } else {
      throw err;
    }
  }
  const next = addCapability(
    existing,
    args.role as Capability,
    type === 'email' ? args.contact : undefined,
  );
  await auth.setCustomUserClaims(uid, next);
  return { path: 'auth-claim', mid: null, fid: null, uid };
}

export async function revokeRole(args: {
  contact: string;
  role: GrantableRole;
}): Promise<{ path: GrantResult['path']; revoked: boolean }> {
  const type = detectType(args.contact);
  const result = await findSetuFamilyByContact(type, args.contact);

  if (result.source === 'setu' && result.mid) {
    await removeMemberRole(result.mid, args.role);
    // Removal must take effect immediately AND survive re-sign-in. The member's
    // existing session carries the stale capability for up to 14 days, and
    // build-session-claims OR's the persisted extraRoles copy back in on next
    // sign-in — so strip the mirrored capability from BOTH the member's auth
    // uids (email + phone) and revoke their refresh tokens.
    const email = typeof result.member?.email === 'string' ? result.member.email : null;
    const phone = typeof result.member?.phone === 'string' ? result.member.phone : null;
    await revokeMemberSessions({ email, phone, stripCaps: [args.role as Capability] });
    return { path: 'roleAssignments', revoked: true };
  }

  const auth = portalAuth();
  const uid = uidOf(type, args.contact);
  try {
    const existing = ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null;
    if (!hasCapability(existing, args.role as Capability)) {
      return { path: 'auth-claim', revoked: false };
    }
    await auth.setCustomUserClaims(uid, removeCapability(existing, args.role as Capability));
    // Force sign-out so the stale session cookie can't keep the capability.
    await revokeUidSessions(uid);
    return { path: 'auth-claim', revoked: true };
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      return { path: 'auth-claim', revoked: false };
    }
    throw err;
  }
}

/**
 * Resolve a contact to the identity keys used for grant/revoke routing so a
 * caller (e.g. the DELETE route's self-lockout guard) can compare the target
 * against their own session without re-deriving the dual-path logic.
 *
 * `mid` is set when the contact maps to a Setu family member; `uid` is always
 * the canonical legacy auth-claim uid for the contact (matches what a future
 * OTP sign-in would land on). A self-lockout exists when either the resolved
 * `mid` equals the caller's `mid` or the resolved `uid` equals the caller's `uid`.
 */
export async function resolveContactIdentity(
  contact: string,
): Promise<{ mid: string | null; uid: string }> {
  const type = detectType(contact);
  const result = await findSetuFamilyByContact(type, contact);
  const mid = result.source === 'setu' && result.mid ? result.mid : null;
  return { mid, uid: uidOf(type, contact) };
}

// --- listSevaks(): merged, deduped-by-person sevak reader -------------------

interface MutableSevakRow {
  key: string;
  mid: string | null;
  fid: string | null;
  uid: string | null;
  name: string;
  contact: string;
  roles: Set<GrantableRole>;
  isTeacher: boolean;
  teacherLevels: string[];
  source: 'family' | 'staff';
}

function memberNameContact(data: Record<string, unknown> | undefined): {
  name: string;
  contact: string;
} {
  const first = typeof data?.firstName === 'string' ? data.firstName : '';
  const last = typeof data?.lastName === 'string' ? data.lastName : '';
  const name = `${first} ${last}`.trim();
  const email = typeof data?.email === 'string' ? data.email : '';
  const phone = typeof data?.phone === 'string' ? data.phone : '';
  return { name, contact: email || phone };
}

/**
 * Every sevak — family-member admins/welcome-team (roleAssignments),
 * non-family auth-claim admins/welcome-team, and teachers (parent-mid or
 * standalone tid) — merged and deduped to one row per distinct person.
 *
 * Dedupe key: mid when known, else tid, else uid. The same person reached via
 * multiple sources (e.g. a roleAssignment AND a legacy auth-claim on the same
 * contact) lands on a single row.
 */
export async function listSevaks(): Promise<SevakRow[]> {
  const db = portalFirestore();
  const auth = portalAuth();

  // rows keyed by dedupe key; midIndex maps a known mid → that key for merges.
  const rows = new Map<string, MutableSevakRow>();
  const keyByMid = new Map<string, string>();

  function ensureMidRow(mid: string, fid: string | null): MutableSevakRow {
    const existingKey = keyByMid.get(mid);
    if (existingKey) {
      const existing = rows.get(existingKey);
      if (existing) {
        if (!existing.fid && fid) existing.fid = fid;
        return existing;
      }
    }
    const row: MutableSevakRow = {
      key: mid,
      mid,
      fid,
      uid: null,
      name: '',
      contact: '',
      roles: new Set(),
      isTeacher: false,
      teacherLevels: [],
      source: 'family',
    };
    rows.set(mid, row);
    keyByMid.set(mid, mid);
    return row;
  }

  // 1. roleAssignments — admins + welcome-team, accumulated per mid.
  const [admins, welcomeTeam] = await Promise.all([
    listMembersWithRole('admin'),
    listMembersWithRole('welcome-team'),
  ]);

  const roleByMid = new Map<string, { fid: string; roles: Set<GrantableRole> }>();
  for (const a of admins) {
    const entry = roleByMid.get(a.mid) ?? { fid: a.fid, roles: new Set<GrantableRole>() };
    entry.roles.add('admin');
    if (!entry.fid && a.fid) entry.fid = a.fid;
    roleByMid.set(a.mid, entry);
  }
  for (const w of welcomeTeam) {
    const entry = roleByMid.get(w.mid) ?? { fid: w.fid, roles: new Set<GrantableRole>() };
    entry.roles.add('welcome-team');
    if (!entry.fid && w.fid) entry.fid = w.fid;
    roleByMid.set(w.mid, entry);
  }

  // Resolve member name/contact for each role-assigned mid.
  await Promise.all(
    [...roleByMid.entries()].map(async ([mid, { fid, roles }]) => {
      const row = ensureMidRow(mid, fid);
      for (const r of roles) row.roles.add(r);
      const memberSnap = await db
        .collection('families')
        .doc(fid)
        .collection('members')
        .doc(mid)
        .get();
      const data = memberSnap.exists
        ? (memberSnap.data() as Record<string, unknown>)
        : undefined;
      const { name, contact } = memberNameContact(data);
      if (name) row.name = name;
      if (contact) row.contact = contact;
    }),
  );

  // 2. teacherAssignments — parent-mid rows merge; standalone tids get their own row.
  const taSnap = await db.collection('teacherAssignments').get();
  const assignments = taSnap.docs
    .map((d) => {
      const data = d.data() as { ref?: string; levelIds?: string[] } | undefined;
      const ref = typeof data?.ref === 'string' && data.ref ? data.ref : d.id;
      const levelIds = Array.isArray(data?.levelIds)
        ? data.levelIds.filter((l): l is string => typeof l === 'string' && l.length > 0)
        : [];
      return { ref, levelIds };
    })
    .filter((a) => a.levelIds.length > 0);

  // Resolve all referenced levelIds → levelName in one batch.
  const allLevelIds = [...new Set(assignments.flatMap((a) => a.levelIds))];
  const levelNameById = new Map<string, string>();
  if (allLevelIds.length > 0) {
    const levelRefs = allLevelIds.map((id) => db.collection('levels').doc(id));
    const levelSnaps = await db.getAll(...levelRefs);
    for (let i = 0; i < allLevelIds.length; i++) {
      const id = allLevelIds[i];
      const snap = levelSnaps[i];
      if (!id || !snap || !snap.exists) continue;
      const data = snap.data() as { levelName?: unknown } | undefined;
      levelNameById.set(id, typeof data?.levelName === 'string' ? data.levelName : id);
    }
  }

  for (const a of assignments) {
    const levelNames = a.levelIds.map((id) => levelNameById.get(id) ?? id);

    // Is this ref a member mid (parent-teacher) or a standalone tid?
    const memberSnap = await db
      .collectionGroup('members')
      .where('mid', '==', a.ref)
      .limit(1)
      .get();
    const memberDoc = memberSnap.docs[0];

    if (memberDoc) {
      const fid = memberDoc.ref.parent.parent?.id ?? null;
      const row = ensureMidRow(a.ref, fid);
      row.isTeacher = true;
      row.teacherLevels = [...new Set([...row.teacherLevels, ...levelNames])];
      if (!row.name || !row.contact) {
        const { name, contact } = memberNameContact(
          memberDoc.data() as Record<string, unknown>,
        );
        if (!row.name && name) row.name = name;
        if (!row.contact && contact) row.contact = contact;
      }
      continue;
    }

    // Standalone teacher — teachers/{tid}.
    const teacherSnap = await db.collection('teachers').doc(a.ref).get();
    const existing = rows.get(a.ref);
    const data = teacherSnap.exists
      ? (teacherSnap.data() as Record<string, unknown>)
      : undefined;
    const { name, contact } = memberNameContact(data);
    if (existing) {
      existing.isTeacher = true;
      existing.teacherLevels = [...new Set([...existing.teacherLevels, ...levelNames])];
      if (!existing.name && name) existing.name = name;
      if (!existing.contact && contact) existing.contact = contact;
    } else {
      rows.set(a.ref, {
        key: a.ref,
        mid: null,
        fid: null,
        uid: null,
        name: name || a.ref,
        contact,
        roles: new Set(),
        isTeacher: true,
        teacherLevels: levelNames,
        source: 'staff',
      });
    }
  }

  // 3. Auth claims — admins/welcome-team on the legacy non-family path.
  // This pass also enumerates EVERY auth user (family OTP users included), so we
  // capture each one's last sign-in here — any row then resolves its person's
  // most recent sign-in by their canonical uid with no extra read.
  const lastSignInByUid = new Map<string, string>();
  let token: string | undefined;
  do {
    const page = await auth.listUsers(1000, token);
    for (const u of page.users) {
      if (u.metadata?.lastSignInTime) {
        lastSignInByUid.set(u.uid, new Date(u.metadata.lastSignInTime).toISOString());
      }
      const claims = (u.customClaims as ClaimsShape | undefined) ?? null;
      const claimRoles: GrantableRole[] = [];
      if (hasCapability(claims, 'admin')) claimRoles.push('admin');
      if (hasCapability(claims, 'welcome-team')) claimRoles.push('welcome-team');
      if (claimRoles.length === 0) continue;

      const claimsEmail = typeof claims?.email === 'string' ? claims.email : null;
      const claimsPhone = typeof claims?.phone === 'string' ? claims.phone : null;
      const contact = u.email ?? claimsEmail ?? claimsPhone ?? '';

      // Does this contact resolve to an existing family mid? If so, merge.
      let mergedIntoMid: string | null = null;
      if (contact) {
        const type = contact.includes('@') ? 'email' : 'phone';
        const fam = await findSetuFamilyByContact(type, contact);
        if (fam.source === 'setu' && fam.mid) mergedIntoMid = fam.mid;
      }

      if (mergedIntoMid) {
        const row = ensureMidRow(mergedIntoMid, null);
        for (const r of claimRoles) row.roles.add(r);
        if (!row.contact && contact) row.contact = contact;
        continue;
      }

      // Standalone non-family sevak — keyed by uid.
      const existing = rows.get(u.uid);
      if (existing) {
        for (const r of claimRoles) existing.roles.add(r);
        if (!existing.uid) existing.uid = u.uid;
        if (!existing.contact && contact) existing.contact = contact;
        continue;
      }
      rows.set(u.uid, {
        key: u.uid,
        mid: null,
        fid: null,
        uid: u.uid,
        name: contact || u.uid,
        contact,
        roles: new Set(claimRoles),
        isTeacher: false,
        teacherLevels: [],
        source: 'staff',
      });
    }
    token = page.pageToken;
  } while (token);

  const ROLE_ORDER: GrantableRole[] = ['admin', 'welcome-team'];
  const out: SevakRow[] = [...rows.values()].map((r) => {
    // The person's auth uid: a standalone auth-claim sevak carries it directly;
    // a family member's is the canonical sha256(normalizedContact) — the same
    // uid OTP sign-in lands on — so a contact resolves their last sign-in.
    const candidateUid = r.uid ?? (r.contact ? uidOf(detectType(r.contact), r.contact) : null);
    return {
      key: r.key,
      mid: r.mid,
      fid: r.fid,
      uid: r.uid,
      name: r.name || r.contact || r.key,
      contact: r.contact,
      roles: ROLE_ORDER.filter((role) => r.roles.has(role)),
      isTeacher: r.isTeacher,
      teacherLevels: r.teacherLevels,
      source: r.source,
      lastSignIn: candidateUid ? (lastSignInByUid.get(candidateUid) ?? null) : null,
    };
  });

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
