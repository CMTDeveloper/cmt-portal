import { describe, it, expect, vi } from 'vitest';
import { deriveConfirmedFidsForLevel, type LevelEnrollment } from '../roster-confirmation';

vi.mock('@/features/setu/donations/legacy-payment', () => ({
  getLegacyPaymentStatus: vi.fn(async (lf: string) => (lf === 'legacy-PAID' ? 'paid' : 'partial')),
}));

// Minimal fake Firestore covering the 3 read shapes this helper uses.
function fakeDb(opts: {
  attendance: Array<{ mid: string; status: string }>;
  paymentSource?: string;
  donationsByFid?: Record<string, Array<{ status: string; eid: string }>>;
}) {
  return {
    collection(name: string) {
      if (name === 'attendanceEvents') {
        return { where: () => ({ get: async () => ({ docs: opts.attendance.map((d) => ({ data: () => d })) }) }) };
      }
      if (name === 'offerings') {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ paymentSource: opts.paymentSource ?? 'portal' }) }) }) };
      }
      if (name === 'families') {
        return {
          doc: (fid: string) => ({
            collection: () => ({
              where: () => ({ get: async () => ({ docs: (opts.donationsByFid?.[fid] ?? []).map((d) => ({ data: () => d })) }) }),
            }),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as FirebaseFirestore.Firestore;
}

const base = (o: Partial<LevelEnrollment>): LevelEnrollment => ({
  fid: 'F', eid: 'F-o', oid: 'o', enrolledVia: 'promotion', enrolledMids: ['F-01'], legacyFid: null, ...o,
});

describe('deriveConfirmedFidsForLevel', () => {
  it('confirms family-initiated and first-attendance without any reads', async () => {
    const db = fakeDb({ attendance: [] });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'A', eid: 'A-o', enrolledMids: ['A-01'], enrolledVia: 'family-initiated' }),
      base({ fid: 'B', eid: 'B-o', enrolledMids: ['B-01'], enrolledVia: 'first-attendance' }),
    ]);
    expect(set).toEqual(new Set(['A', 'B']));
  });

  it('confirms a promotion enrollment once any enrolled mid has a present/late mark', async () => {
    const db = fakeDb({ attendance: [{ mid: 'C-02', status: 'present' }] });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'C', eid: 'C-o', enrolledMids: ['C-01', 'C-02'] }), // C-02 attended
      base({ fid: 'D', eid: 'D-o', enrolledMids: ['D-01'] }),        // no signal
    ]);
    expect(set).toEqual(new Set(['C']));
  });

  it('confirms via a completed donation tied to the eid, and via legacy-paid', async () => {
    const db = fakeDb({
      attendance: [],
      paymentSource: 'legacy',
      donationsByFid: { E: [{ status: 'completed', eid: 'E-o' }] },
    });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'E', eid: 'E-o' }),                                   // donation
      base({ fid: 'G', eid: 'G-o', legacyFid: 'legacy-PAID' }),         // legacy-paid
      base({ fid: 'H', eid: 'H-o', legacyFid: 'legacy-partial' }),      // nothing → not confirmed
    ]);
    expect(set).toEqual(new Set(['E', 'G']));
  });
});
