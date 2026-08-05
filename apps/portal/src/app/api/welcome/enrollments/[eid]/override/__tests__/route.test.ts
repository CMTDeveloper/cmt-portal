import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: () => 'ts' },
}));
vi.mock('@/features/setu/audit/audit-log', () => ({ writeAuditLog: vi.fn() }));
const mockAdultClassKeys = vi.hoisted(() => vi.fn());
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
