import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The member write core, extracted so the staff cross-family routes cannot
 * drift from the family self-serve ones.
 *
 * The route-level suites (api/setu/members and api/setu/members/[mid]) remain
 * the behaviour contract and must keep passing UNMODIFIED. This file covers
 * what those cannot: the required-field pickers in isolation, the audit row
 * (which only a staff actor produces), and the mid allocator's collision
 * guard.
 */

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: vi.fn((type: string, value: string) => `hash:${type}:${value}`),
}));
vi.mock('@/features/setu/ids/public-id-allocator', () => ({
  allocateMemberPublicIds: vi.fn(async (count: number) =>
    Array.from({ length: count }, (_, i) => String(50001 + i)),
  ),
}));
vi.mock('@/features/setu/enrollment/sync-enrollment-members', () => ({
  syncActiveEnrollmentMemberships: vi.fn(async () => ({ updated: [] })),
}));
vi.mock('@/features/setu/auth/revoke-sessions', () => ({
  revokeMemberSessions: vi.fn(async () => ({ uids: [] })),
  RESURRECTABLE_SEVAK_CAPS: ['admin', 'welcome-team', 'coordinator'],
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import {
  addMember,
  updateMember,
  deleteMember,
  firstMissingRequiredField,
  firstMissingRequiredFieldForPatch,
  type Actor,
} from '../write-member';
import { makeFakeDb, auditRows } from './fake-member-db';

const FID = 'FAM001ABCD12';
const STAFF: Actor = { uid: 'uid-staff', mid: null, role: 'welcome-team', extraRoles: [] };

// The fake Firestore is shared with the staff route suites (fake-member-db.ts)
// so both exercise the same document model.

function seedFamily(extra: Record<string, unknown> = {}) {
  return {
    [`families/${FID}`]: { fid: FID, managers: [`${FID}-01`] },
    ...extra,
  };
}

const CHILD_BODY = {
  firstName: 'Diya',
  lastName: 'Patel',
  type: 'Child',
  gender: 'Female',
  foodAllergies: 'None',
  schoolGrade: 'Grade 5',
  birthMonthYear: '2015-05',
};

const CHILD_DOC = {
  mid: `${FID}-02`,
  type: 'Child',
  manager: false,
  gender: 'Female',
  firstName: 'Diya',
  lastName: 'Patel',
  email: null,
  phone: null,
  schoolGrade: 'Grade 5',
  birthMonthYear: '2015-05',
  volunteeringSkills: [],
  foodAllergies: 'None',
};

function useDb(docs: Record<string, unknown>) {
  const fake = makeFakeDb(docs);
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue(fake.db);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── The required-field pickers ────────────────────────────────────────────────

describe('firstMissingRequiredField (add scope)', () => {
  it('returns null for a complete Child', () => {
    expect(firstMissingRequiredField({ ...CHILD_BODY, type: 'Child' })).toBeNull();
  });

  it('returns grade-required for a Child with no schoolGrade', () => {
    expect(firstMissingRequiredField({ ...CHILD_BODY, type: 'Child', schoolGrade: null })).toBe(
      'grade-required',
    );
  });

  it('returns birthmonth-required for a Child with no birthMonthYear', () => {
    expect(firstMissingRequiredField({ ...CHILD_BODY, type: 'Child', birthMonthYear: null })).toBe(
      'birthmonth-required',
    );
  });

  it('returns contact-required for an Adult with no email', () => {
    expect(
      firstMissingRequiredField({
        type: 'Adult',
        firstName: 'Priya',
        lastName: 'Patel',
        gender: 'Female',
        foodAllergies: 'None',
        phone: '4165550000',
        volunteeringSkills: ['Teaching / Facilitation'],
      }),
    ).toBe('contact-required');
  });

  it('returns skills-required for an Adult with no volunteering skills', () => {
    expect(
      firstMissingRequiredField({
        type: 'Adult',
        firstName: 'Priya',
        lastName: 'Patel',
        gender: 'Female',
        foodAllergies: 'None',
        email: 'p@example.com',
        phone: '4165550000',
        volunteeringSkills: [],
      }),
    ).toBe('skills-required');
  });

  it('surfaces foodAllergies ahead of grade when both are missing (deterministic order)', () => {
    // Several fields missing at once must always yield the SAME code, or the
    // client toast changes depending on evaluation order.
    expect(
      firstMissingRequiredField({ ...CHILD_BODY, type: 'Child', foodAllergies: null, schoolGrade: null }),
    ).toBe('foodAllergies-required');
  });
});

describe('firstMissingRequiredFieldForPatch (patch scope)', () => {
  const incompleteChild = { ...CHILD_BODY, type: 'Child' as const, foodAllergies: null };

  it('does NOT block a patch that leaves a still-missing field untouched', () => {
    // Legacy-incomplete docs must stay editable; blocking here would strand a
    // family that cannot fix the field from the screen they are on.
    expect(firstMissingRequiredFieldForPatch(incompleteChild, { firstName: 'Renamed' }, false)).toBeNull();
  });

  it('blocks when the patch itself clears the required field', () => {
    expect(firstMissingRequiredFieldForPatch(incompleteChild, { foodAllergies: '' }, false)).toBe(
      'foodAllergies-required',
    );
  });

  it('re-evaluates EVERY required field when the patch flips type', () => {
    // A Child promoted to Adult must satisfy the adult matrix even for fields
    // the patch never mentions.
    const flipped = { ...CHILD_BODY, type: 'Adult' as const, email: null, phone: null, volunteeringSkills: [] };
    expect(firstMissingRequiredFieldForPatch(flipped, { type: 'Adult' }, true)).toBe('skills-required');
  });
});

// ── addMember ─────────────────────────────────────────────────────────────────

describe('addMember', () => {
  it('allocates the next mid as max-suffix + 1, never count + 1', async () => {
    // Regression guard for the 2026-07-19 data loss: with -02 deleted the member
    // COUNT is 2, so count+1 would resolve to -03 and txn.set would silently
    // overwrite the live -03 member.
    const { writes } = useDb(
      seedFamily({
        [`families/${FID}/members/${FID}-01`]: { mid: `${FID}-01` },
        [`families/${FID}/members/${FID}-03`]: { mid: `${FID}-03` },
      }),
    );

    const res = await addMember({ fid: FID, body: CHILD_BODY, actor: null });

    expect(res.ok).toBe(true);
    expect(res.ok && res.mid).toBe(`${FID}-04`);
    expect(writes.some((w) => w.path === `families/${FID}/members/${FID}-03`)).toBe(false);
  });

  it('writes an audit row when a staff actor is supplied', async () => {
    const { writes } = useDb(seedFamily());

    const res = await addMember({ fid: FID, body: CHILD_BODY, actor: STAFF });

    expect(res.ok).toBe(true);
    const rows = auditRows(writes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'member.create',
      actorUid: 'uid-staff',
      actorRole: 'welcome-team',
      fid: FID,
      mid: `${FID}-01`,
      before: null,
    });
  });

  it('writes NO audit row for a family self-serve add (actor null)', async () => {
    // The log exists to answer "which staff member changed this?". Family
    // self-serve writes would bury that signal in noise.
    const { writes } = useDb(seedFamily());

    await addMember({ fid: FID, body: CHILD_BODY, actor: null });

    expect(auditRows(writes)).toHaveLength(0);
  });

  it('refuses a contact already owned by a DIFFERENT family', async () => {
    const adult = {
      firstName: 'Priya',
      lastName: 'Patel',
      type: 'Adult',
      gender: 'Female',
      foodAllergies: 'None',
      email: 'taken@example.com',
      phone: '4165550000',
      volunteeringSkills: ['Teaching / Facilitation'],
    };
    useDb(
      seedFamily({
        'contactKeys/hash:email:taken@example.com': { fid: 'SOMEONE-ELSE' },
      }),
    );

    const res = await addMember({ fid: FID, body: adult, actor: STAFF });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(409);
    expect(res.ok === false && res.body).toMatchObject({
      error: 'contact-already-registered',
      field: 'email',
    });
  });

  it('rejects an invalid body with the zod issues the client surfaces', async () => {
    useDb(seedFamily());
    const { firstName: _dropped, ...rest } = CHILD_BODY;
    void _dropped;

    const res = await addMember({ fid: FID, body: rest, actor: STAFF });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(400);
    expect(res.ok === false && (res.body as { error: string }).error).toBe('bad-request');
    expect(res.ok === false && Array.isArray((res.body as { issues: unknown[] }).issues)).toBe(true);
  });
});

// ── updateMember ──────────────────────────────────────────────────────────────

describe('updateMember', () => {
  it('records both sides of a staff edit', async () => {
    const { writes } = useDb(
      seedFamily({ [`families/${FID}/members/${FID}-02`]: CHILD_DOC }),
    );

    const res = await updateMember({
      fid: FID,
      mid: `${FID}-02`,
      body: { schoolGrade: 'Grade 6' },
      actor: STAFF,
      canSetManagerFlag: true,
    });

    expect(res.ok).toBe(true);
    const rows = auditRows(writes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'member.update',
      fid: FID,
      mid: `${FID}-02`,
      after: { schoolGrade: 'Grade 6' },
    });
    expect((rows[0] as { before: Record<string, unknown> }).before).toMatchObject({
      schoolGrade: 'Grade 5',
    });
  });

  it('writes NO audit row for a family self-serve edit', async () => {
    const { writes } = useDb(
      seedFamily({ [`families/${FID}/members/${FID}-02`]: CHILD_DOC }),
    );

    await updateMember({
      fid: FID,
      mid: `${FID}-02`,
      body: { schoolGrade: 'Grade 6' },
      actor: null,
      canSetManagerFlag: true,
    });

    expect(auditRows(writes)).toHaveLength(0);
  });

  it('refuses a manager-flag change when the caller may not set it', async () => {
    useDb(seedFamily({ [`families/${FID}/members/${FID}-02`]: CHILD_DOC }));

    const res = await updateMember({
      fid: FID,
      mid: `${FID}-02`,
      body: { manager: true },
      actor: null,
      canSetManagerFlag: false,
    });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(403);
    expect(res.ok === false && (res.body as { error: string }).error).toBe(
      'manager-flag-requires-manager-role',
    );
  });

  it('refuses a member whose mid belongs to another family', async () => {
    // Defence in depth behind the route gate: the doc path already scopes the
    // read, so this only fires on a malformed doc, but a staff route reaching
    // across families makes the check load-bearing rather than theoretical.
    useDb(
      seedFamily({
        [`families/${FID}/members/${FID}-02`]: { ...CHILD_DOC, mid: 'OTHERFAM-02' },
      }),
    );

    const res = await updateMember({
      fid: FID,
      mid: `${FID}-02`,
      body: { schoolGrade: 'Grade 6' },
      actor: STAFF,
      canSetManagerFlag: true,
    });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(403);
  });
});

// ── deleteMember ──────────────────────────────────────────────────────────────

describe('deleteMember', () => {
  it('records the removed member with after: null', async () => {
    const { writes, deletes } = useDb(
      seedFamily({ [`families/${FID}/members/${FID}-02`]: CHILD_DOC }),
    );

    const res = await deleteMember({ fid: FID, mid: `${FID}-02`, actor: STAFF });

    expect(res.ok).toBe(true);
    expect(deletes).toContain(`families/${FID}/members/${FID}-02`);
    const rows = auditRows(writes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'member.delete', mid: `${FID}-02`, after: null });
    // Without `before`, the row cannot answer what was lost — the one question
    // anyone asks after an accidental removal.
    expect((rows[0] as { before: Record<string, unknown> }).before).toMatchObject({
      firstName: 'Diya',
    });
  });

  it('writes NO audit row for a family self-serve delete', async () => {
    const { writes } = useDb(
      seedFamily({ [`families/${FID}/members/${FID}-02`]: CHILD_DOC }),
    );

    await deleteMember({ fid: FID, mid: `${FID}-02`, actor: null });

    expect(auditRows(writes)).toHaveLength(0);
  });

  it('refuses to remove the last manager', async () => {
    useDb({
      [`families/${FID}`]: { fid: FID, managers: [`${FID}-01`] },
      [`families/${FID}/members/${FID}-01`]: { ...CHILD_DOC, mid: `${FID}-01`, manager: true },
    });

    const res = await deleteMember({ fid: FID, mid: `${FID}-01`, actor: STAFF });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(409);
    expect(res.ok === false && (res.body as { error: string }).error).toBe('last-manager');
  });

  it('returns not-found for a member that does not exist', async () => {
    useDb(seedFamily());

    const res = await deleteMember({ fid: FID, mid: `${FID}-09`, actor: STAFF });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(404);
  });
});
