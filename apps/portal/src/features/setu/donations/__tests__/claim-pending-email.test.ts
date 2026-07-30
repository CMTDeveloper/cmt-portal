import { describe, it, expect, vi, beforeEach } from 'vitest';

// A block body, never `() => expr` - see the note in bv-enrollment-emails.test.ts.
const { portalFirestore } = vi.hoisted(() => ({ portalFirestore: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore }));

import { claimPendingEmail, PENDING_EMAIL_COOLDOWN_DAYS } from '../claim-pending-email';

/** A Firestore stand-in with exactly the surface claimPendingEmail touches. */
function fakeDb(doc: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const ref = { __ref: true };
  const db = {
    collection: () => ({
      doc: () => ({ collection: () => ({ doc: () => ref }) }),
    }),
    runTransaction: async (fn: (txn: unknown) => Promise<boolean>) =>
      fn({
        get: async () => ({ exists: doc !== null, data: () => doc }),
        update: (_r: unknown, patch: Record<string, unknown>) => updates.push(patch),
      }),
  };
  return { db, updates };
}

const NOW = new Date('2026-09-13T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeEach(() => {
  portalFirestore.mockReset();
});

describe('claimPendingEmail', () => {
  it('grants the claim, and stamps, when the family has never been told', async () => {
    const { db, updates } = fakeDb({});
    portalFirestore.mockReturnValue(db);

    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(true);
    expect(updates).toEqual([{ pendingEmailSentAt: NOW }]);
  });

  // The whole reason this exists: the cancel page re-renders on reload, and the
  // kiosk fires every Sunday. Neither may mail the same family twice.
  it('refuses inside the cooldown, and writes nothing', async () => {
    const { db, updates } = fakeDb({ pendingEmailSentAt: daysAgo(1) });
    portalFirestore.mockReturnValue(db);

    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(false);
    expect(updates).toEqual([]);
  });

  it('grants again once the cooldown has fully elapsed', async () => {
    const { db } = fakeDb({ pendingEmailSentAt: daysAgo(PENDING_EMAIL_COOLDOWN_DAYS + 1) });
    portalFirestore.mockReturnValue(db);

    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(true);
  });

  // Pins the boundary rather than leaving it to whoever next edits the compare.
  // At EXACTLY the cooldown the wait is over, so the claim is granted; a moment
  // under it is refused. Both directions asserted, because `<` vs `<=` here is
  // the difference between a weekly nudge and a family being mailed twice on the
  // same Sunday if two door tablets are a hair apart.
  it('grants at exactly the cooldown, and refuses a moment before it', async () => {
    const atBoundary = fakeDb({ pendingEmailSentAt: daysAgo(PENDING_EMAIL_COOLDOWN_DAYS) });
    portalFirestore.mockReturnValue(atBoundary.db);
    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(true);

    const justUnder = fakeDb({
      pendingEmailSentAt: new Date(daysAgo(PENDING_EMAIL_COOLDOWN_DAYS).getTime() + 1000),
    });
    portalFirestore.mockReturnValue(justUnder.db);
    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(false);
  });

  it('reads a Firestore Timestamp, not just a Date', async () => {
    const ts = { toDate: () => daysAgo(1) };
    const { db } = fakeDb({ pendingEmailSentAt: ts });
    portalFirestore.mockReturnValue(db);

    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(false);
  });

  it('reads an ISO string too', async () => {
    const { db } = fakeDb({ pendingEmailSentAt: daysAgo(1).toISOString() });
    portalFirestore.mockReturnValue(db);

    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(false);
  });

  // ── The fail-CLOSED directions ────────────────────────────────────────────
  // Every one of these could plausibly have been written to "just send", and
  // each would mean duplicate mail from the temple.
  it('refuses when the enrollment does not exist', async () => {
    const { db, updates } = fakeDb(null);
    portalFirestore.mockReturnValue(db);

    expect(await claimPendingEmail('CMT-F', 'GONE', NOW)).toBe(false);
    expect(updates).toEqual([]);
  });

  it('refuses on a FUTURE stamp (clock skew or a bad backfill)', async () => {
    const { db } = fakeDb({ pendingEmailSentAt: daysAgo(-30) });
    portalFirestore.mockReturnValue(db);

    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(false);
  });

  it('refuses on a present-but-unreadable stamp rather than treating it as never-sent', async () => {
    const { db } = fakeDb({ pendingEmailSentAt: { nonsense: true } });
    portalFirestore.mockReturnValue(db);

    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(false);
  });

  it('refuses, rather than throwing, when Firestore is unreachable', async () => {
    portalFirestore.mockImplementation(() => {
      throw new Error('firestore down');
    });

    expect(await claimPendingEmail('CMT-F', 'EID', NOW)).toBe(false);
  });
});
