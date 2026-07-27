import { it, expect, vi, beforeEach } from 'vitest';

const { mockDerive, mockDoor, mockDetail } = vi.hoisted(() => ({
  mockDerive: vi.fn(),
  mockDoor: vi.fn(),
  mockDetail: vi.fn(),
}));
vi.mock('../roster', () => ({ deriveRoster: mockDerive }));
vi.mock('@/features/setu/attendance/check-in-attendance', () => ({ readDoorPresentSids: mockDoor }));
vi.mock('../attendance-detail', () => ({ buildAttendanceDetailIndex: mockDetail }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));

import { getLevelAttendanceView } from '../level-attendance-view';

beforeEach(() => {
  mockDerive.mockReset();
  mockDoor.mockReset();
  mockDetail.mockReset();
  mockDetail.mockResolvedValue(new Map());
});

it('seeds unmarked by default; door check-in → present; portal mark wins', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton', pid: 'o-bv', date: '2026-01-04',
    markedCount: 1, total: 3,
    members: [
      { mid: 'F-02', fid: 'F', firstName: 'A', lastName: 'Z', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'absent', legacyFid: '4421', legacySid: 'S8' },
      { mid: 'F-03', fid: 'F', firstName: 'B', lastName: 'Y', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: true, status: 'unaccounted', legacyFid: '4421', legacySid: 'S9' },
      { mid: 'G-02', fid: 'G', firstName: 'C', lastName: 'X', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'unaccounted', legacyFid: '7000', legacySid: 'S1' },
    ],
    previousStudents: [
      { mid: 'P-02', fid: 'P', firstName: 'Prev', lastName: 'One', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
    previousTotal: 1,
  });
  mockDoor.mockResolvedValue(new Set(['S9'])); // only F-03 checked in at the door

  const view = await getLevelAttendanceView('L', '2026-01-04');
  expect(view).not.toBeNull();
  const byMid = Object.fromEntries(view!.rows.map((r) => [r.mid, r]));
  // prior portal mark wins
  expect(byMid['F-02']).toMatchObject({ status: 'absent', source: 'portal', checkedInAtDoor: false });
  // door check-in → present
  expect(byMid['F-03']).toMatchObject({ status: 'present', source: 'door', checkedInAtDoor: true });
  // no portal mark + no door → unmarked (null)
  expect(byMid['G-02']).toMatchObject({ status: null, source: 'default', checkedInAtDoor: false });
  // presentCount counts only present rows (door + portal) — NOT the total
  expect(view!.presentCount).toBe(1);
  expect(view!.total).toBe(3);
  // previousCount reflects the unconfirmed carry-forward students
  expect(view!.previousCount).toBe(1);
  expect(mockDoor).toHaveBeenCalledWith(['4421', '7000'], '2026-01-04'); // unique non-null legacyFids
});

it('joins parent contact, payment and safety notes onto each row by fid', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton', pid: 'o-bv', date: '2026-01-04',
    markedCount: 0, total: 3,
    members: [
      // Two SIBLINGS in one family plus a child from another: the join is by fid,
      // so siblings must both get their family's contact, and family G must not
      // inherit family F's.
      { mid: 'F-02', fid: 'F', firstName: 'A', lastName: 'Z', type: 'Child', schoolGrade: 'Grade 1', foodAllergies: 'Peanuts', hasSafetyInfo: true, status: 'unaccounted', legacyFid: null, legacySid: null },
      { mid: 'F-03', fid: 'F', firstName: 'B', lastName: 'Y', type: 'Child', schoolGrade: 'Grade 1', foodAllergies: null, hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
      { mid: 'G-02', fid: 'G', firstName: 'C', lastName: 'X', type: 'Child', schoolGrade: 'Grade 1', foodAllergies: null, hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
    previousStudents: [
      { mid: 'P-02', fid: 'P', firstName: 'Prev', lastName: 'One', type: 'Child', schoolGrade: 'Grade 1', foodAllergies: null, hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
    previousTotal: 1,
    enrMetaByFid: new Map([['F', { oid: 'o' }], ['G', { oid: 'o' }]]),
    managerMidByFid: new Map([['F', 'F-01'], ['G', 'G-01']]),
  });
  mockDetail.mockResolvedValue(
    new Map([
      ['F', { parentName: 'Fiona F', parentPhone: '416-555-0100', parentEmail: 'f@example.com', payment: 'paid' }],
      ['G', { parentName: 'Gita G', parentPhone: null, parentEmail: 'g@example.com', payment: 'outstanding' }],
    ]),
  );

  const view = await getLevelAttendanceView('L', '2026-01-04');
  const byMid = Object.fromEntries(view!.rows.map((r) => [r.mid, r]));

  expect(byMid['F-02']).toMatchObject({
    parentName: 'Fiona F', parentPhone: '416-555-0100', parentEmail: 'f@example.com',
    payment: 'paid', safetyNotes: 'Peanuts',
  });
  // Sibling: same family contact, its OWN (absent) safety note.
  expect(byMid['F-03']).toMatchObject({ parentName: 'Fiona F', payment: 'paid', safetyNotes: null });
  // Different family: its own contact, NOT family F's.
  expect(byMid['G-02']).toMatchObject({ parentName: 'Gita G', parentPhone: null, payment: 'outstanding' });

  // A child with nothing on file gets null, not the sibling's note.
  expect(byMid['G-02']!.safetyNotes).toBeNull();
  // (Whitespace-only text is normalised to null by `buildRoster`, where
  // `hasSafetyInfo` is derived, so the two cannot disagree. That is asserted in
  // roster.test.ts against the real function - asserting it here would only be
  // testing this file's own mock.)
  // hasSafetyInfo stays the derived boolean the dot already uses.
  expect(byMid['F-02']!.hasSafetyInfo).toBe(true);
  expect(byMid['G-02']!.hasSafetyInfo).toBe(false);
});

it('asks for detail on the LEVEL fids only - never the program-scoped set', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton', pid: 'o-bv', date: '2026-01-04',
    markedCount: 0, total: 2,
    members: [
      { mid: 'F-02', fid: 'F', firstName: 'A', lastName: 'Z', type: 'Child', schoolGrade: 'Grade 1', foodAllergies: null, hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
      { mid: 'F-03', fid: 'F', firstName: 'B', lastName: 'Y', type: 'Child', schoolGrade: 'Grade 1', foodAllergies: null, hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
    // A carry-forward family and two other-level families are in the program
    // set. Passing those would reintroduce the fan-out the cap exists to catch.
    previousStudents: [
      { mid: 'P-02', fid: 'P', firstName: 'Prev', lastName: 'One', type: 'Child', schoolGrade: 'Grade 1', foodAllergies: null, hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
    previousTotal: 1,
    enrMetaByFid: new Map([['F', { oid: 'o' }], ['P', { oid: 'o' }], ['OTHER-1', { oid: 'o' }], ['OTHER-2', { oid: 'o' }]]),
    managerMidByFid: new Map([['F', 'F-01'], ['P', 'P-01'], ['OTHER-1', 'O1-01'], ['OTHER-2', 'O2-01']]),
  });

  await getLevelAttendanceView('L', '2026-01-04');
  const fids = mockDetail.mock.calls[0]![1] as string[];
  // Exactly the level's own families, deduplicated across the two siblings.
  expect(fids).toEqual(['F']);
});

it('leaves a row null/unknown when the family is missing from the detail index', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton', pid: 'o-bv', date: '2026-01-04',
    markedCount: 0, total: 1,
    members: [
      { mid: 'F-02', fid: 'F', firstName: 'A', lastName: 'Z', type: 'Child', schoolGrade: 'Grade 1', foodAllergies: null, hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
    previousStudents: [], previousTotal: 0,
    enrMetaByFid: new Map(), managerMidByFid: new Map(),
  });
  mockDetail.mockResolvedValue(new Map()); // detail read came back empty

  const view = await getLevelAttendanceView('L', '2026-01-04');
  // Degrades to "we know nothing", never to a crash and never to a false 'paid'.
  expect(view!.rows[0]).toMatchObject({
    parentName: null, parentPhone: null, parentEmail: null, payment: 'unknown',
  });
});

it('returns null when the level is missing', async () => {
  mockDerive.mockResolvedValue(null);
  expect(await getLevelAttendanceView('nope', '2026-01-04')).toBeNull();
  expect(mockDoor).not.toHaveBeenCalled();
});

it('seeds a new kid with no legacyFid as unmarked (null) and skips the door read', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton', pid: 'o-bv', date: '2026-01-04',
    markedCount: 0, total: 1,
    members: [
      { mid: 'N-02', fid: 'N', firstName: 'New', lastName: 'Kid', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
    previousStudents: [],
    previousTotal: 0,
  });
  const view = await getLevelAttendanceView('L', '2026-01-04');
  expect(view!.rows[0]).toMatchObject({ status: null, source: 'default', checkedInAtDoor: false });
  expect(view!.presentCount).toBe(0);
  expect(mockDoor).not.toHaveBeenCalled();
});
