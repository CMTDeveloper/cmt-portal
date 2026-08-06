import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: () => 'ts' },
}));
vi.mock('@/features/setu/audit/audit-log', () => ({ writeAuditLog: vi.fn() }));
const mockAdultClassKeys = vi.hoisted(() => vi.fn());
const mockFamilyPayment = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/roster/payment', () => ({ deriveFamilyPayment: mockFamilyPayment }));
vi.mock('@/features/setu/adult-class/program-keys', () => ({
  adultStudyClassProgramKeys: mockAdultClassKeys,
  isAdultStudyClassKey: vi.fn(),
}));

import { PATCH } from '../route';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { writeAuditLog } from '@/features/setu/audit/audit-log';

/**
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * This route decides whether a family is asked for money, and it had NO tests.
 * That is how it kept accepting the write the UI had already been fixed to stop
 * offering: on 2026-08-04 the staff control learned that a Scarborough family's
 * adult-class waiver is not a settlement, but the ROUTE still happily recorded
 * one. An admin whose page was open from before the deploy still had the old
 * button, and the endpoint is a plain authenticated PATCH.
 *
 * A UI-only restriction is not a rule; the chokepoint is here.
 */

const mockRunTransaction = vi.fn();
const mockTxnGet = vi.fn();
const mockTxnUpdate = vi.fn();

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/welcome/enrollments/E1/override', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-portal-role': 'admin',
      'x-portal-uid': 'admin-1',
    },
    body: JSON.stringify(body),
  });
}

/** The enrollment as stored, re-read fresh inside the transaction. */
function setup(stored: {
  programKey: string;
  suggestedAmountOverride: number | null;
  settledOffPortal?: boolean;
}) {
  mockRunTransaction.mockReset();
  mockTxnGet.mockReset();
  mockTxnUpdate.mockReset();
  (writeAuditLog as ReturnType<typeof vi.fn>).mockReset();

  mockTxnGet.mockResolvedValue({ data: () => stored });
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => unknown) =>
    fn({ get: mockTxnGet, update: mockTxnUpdate }),
  );

  const enrollmentDoc = {
    ref: { id: 'E1' },
    data: () => ({ status: 'active', fid: 'CMT-F1', ...stored }),
  };
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
    runTransaction: mockRunTransaction,
    collectionGroup: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ empty: false, docs: [enrollmentDoc] }) }) }),
    }),
  });
}

beforeEach(() => {
  mockAdultClassKeys.mockReset();
  // BOTH centres. A fixture with only the literal key would let a key-sniffing
  // regression pass - that is precisely the bug this guard backs up.
  mockAdultClassKeys.mockResolvedValue(['adult-study-class', 'adult-study-east']);
  mockFamilyPayment.mockReset();
  mockFamilyPayment.mockResolvedValue('outstanding');
});

describe('PATCH override — a waiver is not settleable', () => {
  it('refuses to settle an adult-class waiver, and writes NOTHING', async () => {
    setup({ programKey: 'adult-study-east', suggestedAmountOverride: 0 });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: 0, note: 'already collected' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'waived-not-settleable' });
    // The point is not the status code - it is that no false money record exists.
    expect(mockTxnUpdate).not.toHaveBeenCalled();
    // And no audit row claiming a change that never happened.
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('refuses to CLEAR a waiver, which would start billing a covered family', async () => {
    setup({ programKey: 'adult-study-east', suggestedAmountOverride: 0 });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: null, note: 'undo this' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(409);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  it('guards Brampton’s literal-keyed class too, not just the newer centres', async () => {
    setup({ programKey: 'adult-study-class', suggestedAmountOverride: 0 });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: 0, note: 'nope' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(409);
  });
});

describe('PATCH override — the legitimate paths still work', () => {
  it('settles an adult-class enrollment that is NOT already waived', async () => {
    // override null = this family genuinely owes the fee. Settling them
    // off-portal is exactly what the feature is for; the guard must not eat it.
    setup({ programKey: 'adult-study-east', suggestedAmountOverride: null });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: 0, note: 'pre-authorized debit' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ suggestedAmountOverride: 0, settledOffPortal: true }),
    );
  });

  it('settles a Bala Vihar enrollment on a bare zero (the remediation path)', async () => {
    // The production family settled BEFORE settledOffPortal existed reads as a
    // bare zero. It is not an adult class, so it stays settleable - that button
    // is how the record acquires its reason.
    setup({ programKey: 'bala-vihar', suggestedAmountOverride: 0 });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: 0, note: 're-recording' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalled();
  });

  it('undoes a genuine settlement (flag set) on an adult-class row', async () => {
    // settledOffPortal true means an admin recorded it deliberately. Undo must
    // remain available - the guard keys on the ABSENCE of the flag.
    setup({ programKey: 'adult-study-east', suggestedAmountOverride: 0, settledOffPortal: true });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: null, note: 'arrangement ended' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ suggestedAmountOverride: null, settledOffPortal: false }),
    );
  });
});

describe('PATCH override — a family who already paid in the portal', () => {
  it('refuses to settle them off-portal, and writes NOTHING', async () => {
    mockFamilyPayment.mockResolvedValue('paid');
    setup({ programKey: 'bala-vihar', suggestedAmountOverride: null });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: 0, note: 'office collected' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already-paid-in-portal' });
    expect(mockTxnUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('still lets an admin CLEAR an override on a paid family', async () => {
    // Only settlement is refused. Undo must always work, or an admin cannot
    // reverse their own mistake.
    mockFamilyPayment.mockResolvedValue('paid');
    setup({ programKey: 'bala-vihar', suggestedAmountOverride: 0, settledOffPortal: true });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: null, note: 'undo' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalled();
  });

  it('does NOT refuse on an unknown verdict - absence of evidence is not payment', async () => {
    // 'unknown' means we could not price the family, not that they paid.
    // Refusing here would strand exactly the families this feature exists for.
    mockFamilyPayment.mockResolvedValue('unknown');
    setup({ programKey: 'bala-vihar', suggestedAmountOverride: null });

    const res = await PATCH(makeRequest({ suggestedAmountOverride: 0, note: 'pre-authorized debit' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalled();
  });
});

// ── Settlement provenance on the enrollment doc ──────────────────────────────
//
// The same who/when/why has always gone to `audit_log` in this transaction, and
// still does. It was unreadable in practice: audit_log has no reader anywhere in
// the codebase and no Firestore index, so "who marked this family paid?" needed
// a composite index and a prod deploy to answer. These fields put it on a
// document the welcome desk already reads.
describe('PATCH override - settlement provenance', () => {
  /** The same request, plus the email header middleware normally supplies. */
  function requestWithEmail(body: unknown, email: string) {
    return new Request('http://localhost/api/welcome/enrollments/E1/override', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-portal-role': 'admin',
        'x-portal-uid': 'admin-1',
        'x-portal-email': email,
      },
      body: JSON.stringify(body),
    });
  }

  it('stamps who, when and why alongside the flag', async () => {
    setup({ programKey: 'bala-vihar', suggestedAmountOverride: null });

    await PATCH(requestWithEmail({ suggestedAmountOverride: 0, note: 'legacy PAD' }, 'admin@chinmayatoronto.org'), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(mockTxnUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        settledOffPortal: true,
        settledAt: 'ts',
        settledBy: 'admin@chinmayatoronto.org',
        settledNote: 'legacy PAD',
      }),
    );
  });

  it('records the date even when the session carries no email', async () => {
    // `email` is optional on SessionClaims, so `settledBy` is genuinely
    // nullable. The screen has to render "Recorded on <date>" for this case
    // rather than "Recorded by  on <date>" - which is why the field is named
    // settledBy and not settledByName, and why the reader has three branches.
    setup({ programKey: 'bala-vihar', suggestedAmountOverride: null });

    await PATCH(makeRequest({ suggestedAmountOverride: 0, note: 'cash at the office' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(mockTxnUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ settledOffPortal: true, settledAt: 'ts', settledBy: null }),
    );
  });

  it('CLEARS the provenance on undo, rather than leaving a stale attribution', async () => {
    // The direction that matters. An admin clicking Undo restores the ask; if
    // "Recorded by X on Sep 3" survived underneath it, the screen would keep
    // attributing a settlement that no longer exists to a named person.
    setup({ programKey: 'bala-vihar', suggestedAmountOverride: 0, settledOffPortal: true });

    await PATCH(makeRequest({ suggestedAmountOverride: null, note: 'arrangement ended' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(mockTxnUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        settledOffPortal: false,
        settledAt: null,
        settledBy: null,
        settledNote: null,
      }),
    );
  });

  it('still writes the audit row - this denormalization does not replace it', async () => {
    // The audit row is the tamper-evident record and is written inside the same
    // transaction, so a committed write can never lack one. The enrollment
    // fields are display copy, not a substitute.
    setup({ programKey: 'bala-vihar', suggestedAmountOverride: null });

    await PATCH(makeRequest({ suggestedAmountOverride: 0, note: 'cheque' }), {
      params: Promise.resolve({ eid: 'E1' }),
    });

    expect(writeAuditLog).toHaveBeenCalled();
  });
});
