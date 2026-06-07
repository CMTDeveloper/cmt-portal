import { describe, it, expect } from 'vitest';
import { buildRoster, type RosterFamily, type RosterEventInput } from '../roster';

const NOW = new Date('2026-01-15T17:00:00Z');

const level2 = {
  levelId: 'brampton-level-2-bv-brampton-2025-26',
  levelName: 'Level 2',
  ageLabel: 'Grade 2 & 3',
  location: 'Brampton' as const,
  pid: 'bv-brampton-2025-26',
  levelKind: 'level' as const,
  gradeBand: ['2', '3'],
};

function child(mid: string, lastName: string, grade: string | null, over: Partial<RosterFamily['members'][number]> = {}) {
  return { mid, firstName: 'Kid', lastName, type: 'Child' as const, schoolGrade: grade, birthMonthYear: null, foodAllergies: null, legacySid: `sid-${mid}`, ...over };
}
function adult(mid: string, lastName: string, over: Partial<RosterFamily['members'][number]> = {}) {
  return { mid, firstName: 'Parent', lastName, type: 'Adult' as const, schoolGrade: null, birthMonthYear: null, foodAllergies: null, legacySid: `sid-${mid}`, ...over };
}

describe('buildRoster', () => {
  it('matches level children by grade and marks unaccounted when no event', () => {
    const families: RosterFamily[] = [
      { fid: 'CMT-A', legacyFid: 'legacy-A', enrolledMids: ['CMT-A-02', 'CMT-A-01'], members: [child('CMT-A-02', 'Apple', 'Grade 2'), adult('CMT-A-01', 'Apple')] },
      { fid: 'CMT-B', legacyFid: null, enrolledMids: ['CMT-B-02', 'CMT-B-03'], members: [child('CMT-B-02', 'Banana', '3'), child('CMT-B-03', 'Banana', '5')] },
    ];
    const r = buildRoster(level2, families, [], '2026-01-18', NOW);
    // CMT-A-02 (Gr2), CMT-B-02 (3) match; adult + Gr5 excluded
    expect(r.members.map((m) => m.mid).sort()).toEqual(['CMT-A-02', 'CMT-B-02']);
    expect(r.members.every((m) => m.status === 'unaccounted')).toBe(true);
    expect(r.total).toBe(2);
    expect(r.markedCount).toBe(0);
    // legacy bridge fields thread through: family legacyFid + member legacySid
    const a02 = r.members.find((m) => m.mid === 'CMT-A-02')!;
    expect(a02.legacyFid).toBe('legacy-A');
    expect(a02.legacySid).toBe('sid-CMT-A-02');
    const b02 = r.members.find((m) => m.mid === 'CMT-B-02')!;
    expect(b02.legacyFid).toBeNull();
    expect(b02.legacySid).toBe('sid-CMT-B-02');
  });

  it('merges attendance events as status and counts marked', () => {
    const families: RosterFamily[] = [
      { fid: 'CMT-A', legacyFid: 'legacy-A', enrolledMids: ['CMT-A-02'], members: [child('CMT-A-02', 'Apple', 'Grade 2')] },
      { fid: 'CMT-B', legacyFid: null, enrolledMids: ['CMT-B-02'], members: [child('CMT-B-02', 'Banana', 'Grade 3')] },
    ];
    const events: RosterEventInput[] = [{ mid: 'CMT-A-02', status: 'present', isGuest: false }];
    const r = buildRoster(level2, families, events, '2026-01-18', NOW);
    const byMid = Object.fromEntries(r.members.map((m) => [m.mid, m.status]));
    expect(byMid['CMT-A-02']).toBe('present');
    expect(byMid['CMT-B-02']).toBe('unaccounted');
    expect(r.markedCount).toBe(1);
  });

  it('ignores guest events when building the enrolled roster', () => {
    const families: RosterFamily[] = [{ fid: 'CMT-A', legacyFid: 'legacy-A', enrolledMids: ['CMT-A-02'], members: [child('CMT-A-02', 'Apple', 'Grade 2')] }];
    const events: RosterEventInput[] = [
      { mid: 'CMT-A-02', status: 'late', isGuest: false },
      { mid: 'CMT-Z-09', status: 'present', isGuest: true }, // visiting guest, not on roster
    ];
    const r = buildRoster(level2, families, events, '2026-01-18', NOW);
    expect(r.members).toHaveLength(1);
    expect(r.members[0]!.status).toBe('late');
  });

  it('surfaces a safety dot for a child with allergies', () => {
    const families: RosterFamily[] = [
      { fid: 'CMT-A', legacyFid: 'legacy-A', enrolledMids: ['CMT-A-02'], members: [child('CMT-A-02', 'Apple', 'Grade 2', { foodAllergies: 'Peanuts' })] },
    ];
    const r = buildRoster(level2, families, [], '2026-01-18', NOW);
    expect(r.members[0]!.hasSafetyInfo).toBe(true);
  });

  it('parents level matches adults only', () => {
    const parents = { ...level2, levelKind: 'parents' as const, gradeBand: [] };
    const families: RosterFamily[] = [
      { fid: 'CMT-A', legacyFid: 'legacy-A', enrolledMids: ['CMT-A-01', 'CMT-A-02'], members: [adult('CMT-A-01', 'Apple'), child('CMT-A-02', 'Apple', 'Grade 2')] },
    ];
    const r = buildRoster(parents, families, [], '2026-01-18', NOW);
    expect(r.members.map((m) => m.mid)).toEqual(['CMT-A-01']);
  });

  it('sorts by last name then first name', () => {
    const families: RosterFamily[] = [
      { fid: 'CMT-Z', legacyFid: null, enrolledMids: ['CMT-Z-02'], members: [child('CMT-Z-02', 'Zephyr', '2', { firstName: 'Anil' })] },
      { fid: 'CMT-A', legacyFid: 'legacy-A', enrolledMids: ['CMT-A-02'], members: [child('CMT-A-02', 'Apple', '2', { firstName: 'Bala' })] },
    ];
    const r = buildRoster(level2, families, [], '2026-01-18', NOW);
    expect(r.members.map((m) => m.lastName)).toEqual(['Apple', 'Zephyr']);
  });

  it('excludes a grade-matching member NOT in enrolledMids, includes one that is', () => {
    const families: RosterFamily[] = [
      {
        fid: 'CMT-A',
        legacyFid: 'legacy-A',
        // Only the enrolled child is listed; the graduated sibling is omitted.
        enrolledMids: ['CMT-A-02'],
        members: [
          child('CMT-A-02', 'Apple', '2'), // grade-matches AND enrolled → included
          child('CMT-A-03', 'Apple', '3'), // grade-matches but NOT enrolled → excluded
        ],
      },
    ];
    const r = buildRoster(level2, families, [], '2026-01-18', NOW);
    expect(r.members.map((m) => m.mid)).toEqual(['CMT-A-02']);
    expect(r.total).toBe(1);
  });
});
