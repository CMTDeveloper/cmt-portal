import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_DISCLAIMERS_CONFIG } from '@cmt/shared-domain/setu';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));
vi.mock('../config', () => ({
  getDisclaimersConfig: vi.fn(async () => ({
    version: 3,
    intro: DEFAULT_DISCLAIMERS_CONFIG.intro,
    sections: DEFAULT_DISCLAIMERS_CONFIG.sections,
    acknowledgement: DEFAULT_DISCLAIMERS_CONFIG.acknowledgement,
  })),
}));
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: vi.fn(async () => ({ currentYear: '2026-27' })),
}));

import { getDisclaimerStateForFamily, recordDisclaimerAcceptance } from '../acceptance';

const db = {} as FirebaseFirestore.Firestore;

describe('getDisclaimerStateForFamily', () => {
  it('accepted=true when the family accepted the current year + version', async () => {
    const state = await getDisclaimerStateForFamily(db, {
      disclaimersAccepted: { schoolYear: '2026-27', version: 3, acceptedByMid: 'm1' },
    });
    expect(state.accepted).toBe(true);
    expect(state.version).toBe(3);
    expect(state.schoolYear).toBe('2026-27');
    expect(state.sections).toHaveLength(5);
    expect(state.intro).toContain('Hari Om!');
    expect(state.acknowledgement).toContain('I confirm');
  });

  it('accepted=false when no acceptance is stored', async () => {
    const state = await getDisclaimerStateForFamily(db, { disclaimersAccepted: null });
    expect(state.accepted).toBe(false);
  });

  it('accepted=false when the stored version is stale', async () => {
    const state = await getDisclaimerStateForFamily(db, {
      disclaimersAccepted: { schoolYear: '2026-27', version: 2, acceptedByMid: 'm1' },
    });
    expect(state.accepted).toBe(false);
  });
});

describe('recordDisclaimerAcceptance', () => {
  it('merges the acceptance record onto families/{fid}', async () => {
    const set = vi.fn(
      async (_payload: { disclaimersAccepted: Record<string, unknown> }, _opts: unknown) => undefined,
    );
    const familyDoc = { set };
    const dbLocal = {
      collection: vi.fn(() => ({ doc: vi.fn(() => familyDoc) })),
    } as unknown as FirebaseFirestore.Firestore;

    await recordDisclaimerAcceptance(dbLocal, 'CMT-1', {
      version: 3,
      schoolYear: '2026-27',
      byMid: 'm1',
    });

    expect(set).toHaveBeenCalledTimes(1);
    const [payload, opts] = set.mock.calls[0]!;
    expect(payload.disclaimersAccepted).toMatchObject({
      version: 3,
      schoolYear: '2026-27',
      acceptedByMid: 'm1',
      acceptedAt: '__ts__',
    });
    expect(opts).toEqual({ merge: true });
  });
});
