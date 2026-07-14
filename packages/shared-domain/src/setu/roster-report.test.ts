import { describe, it, expect } from 'vitest';
import {
  matchesRosterFilters,
  summarizeRoster,
  deriveLevelOptions,
  deriveGradeOptions,
  type RosterReportRow,
} from './roster-report';

function row(over: Partial<RosterReportRow>): RosterReportRow {
  return {
    fid: 'CMT-A', publicFid: null, legacyFid: null, name: 'A', parentName: 'A Parent', location: 'Brampton',
    memberCount: 2, payment: 'unknown', programs: [], programKeys: [], bvChildren: [],
    ...over,
  };
}

// Two families, kids across two levels + two grades, mixed payment.
const rana = row({
  fid: 'CMT-RANA', name: 'Rana', location: 'Brampton', payment: 'paid',
  programs: ['Bala Vihar'], programKeys: ['bala-vihar'],
  bvChildren: [{ grade: '2', levelName: 'Level 2' }, { grade: '6', levelName: 'Level 5' }],
});
const shah = row({
  fid: 'CMT-SHAH', name: 'Shah', location: 'Scarborough', payment: 'outstanding',
  programs: ['Bala Vihar', 'Tabla'], programKeys: ['bala-vihar', 'tabla'],
  bvChildren: [{ grade: '2', levelName: 'Level 2' }],
});
const rows = [rana, shah];

describe('matchesRosterFilters', () => {
  it('no filters: every family matches', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, {}))).toHaveLength(2);
  });
  it('location filter', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { location: 'Brampton' }))).toEqual([rana]);
  });
  it('program filter matches on programKey', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { program: 'tabla' }))).toEqual([shah]);
  });
  it('payment filter', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { payment: 'paid' }))).toEqual([rana]);
  });
  it('level filter: family with a child in that level', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { level: 'Level 5' }))).toEqual([rana]);
  });
  it('grade filter: family with a child in that grade', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { grade: '6' }))).toEqual([rana]);
  });
  it('grade filter normalizes both sides ("Grade 4" child matches "4")', () => {
    const legacy = row({ fid: 'CMT-LEG', bvChildren: [{ grade: 'Grade 4', levelName: 'Level 4' }] });
    expect(matchesRosterFilters(legacy, { grade: '4' })).toBe(true);
    expect(matchesRosterFilters(legacy, { grade: 'Grade 4' })).toBe(true);
    expect(matchesRosterFilters(legacy, { grade: '5' })).toBe(false);
  });
  it('AND across groups', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { location: 'Brampton', level: 'Level 2' }))).toEqual([rana]);
    expect(rows.filter((r) => matchesRosterFilters(r, { location: 'Scarborough', level: 'Level 5' }))).toEqual([]);
  });
  it('level+grade must be satisfied by the SAME child', () => {
    // rana has (Level 2, grade 2) and (Level 5, grade 6) - no single child is Level 5 + grade 2.
    expect(matchesRosterFilters(rana, { level: 'Level 5', grade: '2' })).toBe(false);
    expect(matchesRosterFilters(rana, { level: 'Level 5', grade: '6' })).toBe(true);
  });
});

describe('summarizeRoster', () => {
  it('counts families and BV children; by-level reflects children, not families', () => {
    const s = summarizeRoster(rows, {});
    expect(s.familyCount).toBe(2);
    expect(s.childCount).toBe(3); // 2 Rana kids + 1 Shah kid
    expect(s.byLevel).toEqual([
      { levelName: 'Level 2', childCount: 2 },
      { levelName: 'Level 5', childCount: 1 },
    ]);
    expect(s.byPayment).toEqual({ paid: 1, outstanding: 1, unknown: 0 });
  });
  it('level filter narrows childCount to matching children only', () => {
    const s = summarizeRoster(rows, { level: 'Level 2' });
    expect(s.familyCount).toBe(2); // both families have a Level 2 child
    expect(s.childCount).toBe(2); // only the two Level 2 kids
    expect(s.byLevel).toEqual([{ levelName: 'Level 2', childCount: 2 }]);
  });
});

describe('option derivation', () => {
  it('levels sorted numerically, distinct', () => {
    expect(deriveLevelOptions(rows)).toEqual(['Level 2', 'Level 5']);
  });
  it('grades are canonical ladder tokens present in data, ladder-ordered (JK/SK before numbers)', () => {
    const mixed = [
      row({ bvChildren: [{ grade: 'JK', levelName: 'Pre-Level A' }, { grade: '10', levelName: 'Level 9' }] }),
      rana, // grades 2, 6
    ];
    expect(deriveGradeOptions(mixed)).toEqual(['JK', '2', '6', '10']);
  });
  it('collapses "Grade 4"/"4" into one option and drops legacy junk grades', () => {
    const dirty = [
      row({ bvChildren: [{ grade: '4', levelName: 'Level 4' }, { grade: 'Grade 4', levelName: 'Level 4' }] }),
      row({ bvChildren: [{ grade: 'Pre L1 (Gr JK-SK)', levelName: null }, { grade: 'J', levelName: null }] }),
    ];
    // "Grade 4" collapses onto "4"; the two un-mappable blobs never surface.
    expect(deriveGradeOptions(dirty)).toEqual(['4']);
  });
});
