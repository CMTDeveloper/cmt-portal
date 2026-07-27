import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));

const { getOpenOfferings, fetchEnabledLevelsForPid, readDoorGuestCheckIns, readPortalGuestChildren } =
  vi.hoisted(() => ({
    getOpenOfferings: vi.fn(),
    fetchEnabledLevelsForPid: vi.fn(),
    readDoorGuestCheckIns: vi.fn(),
    readPortalGuestChildren: vi.fn(),
  }));
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({ getOpenOfferings }));
vi.mock('@/features/setu/enrollment/derive-child-level', () => ({ fetchEnabledLevelsForPid }));
vi.mock('@/features/setu/attendance/check-in-attendance', () => ({
  readDoorGuestCheckIns,
  readPortalGuestChildren,
}));

import { getAllVisitorsView } from '../all-visitors';

const SUNDAY = '2026-09-13';

function child(name: string, grade: string) {
  return { name, grade, parentEmail: `${name.toLowerCase()}@x.com`, parentName: 'P', phone: null };
}
function level(levelId: string, levelName: string, gradeBand: string[]) {
  return { levelId, levelName, levelKind: 'level' as const, gradeBand };
}
function offering(oid: string, location: string | null) {
  return { oid, location, programKey: 'bala-vihar' };
}

beforeEach(() => {
  vi.clearAllMocks();
  readDoorGuestCheckIns.mockResolvedValue([]);
  readPortalGuestChildren.mockResolvedValue([]);
  getOpenOfferings.mockResolvedValue([]);
  fetchEnabledLevelsForPid.mockResolvedValue([]);
});

describe('getAllVisitorsView - which levels it reads', () => {
  // THE BUG THIS EXISTS TO PREVENT. Bala Vihar runs as one offering PER CENTRE
  // (balaViharSourceOidsForYear returns bv-brampton-* AND bv-scarborough-*), and
  // fetchEnabledLevelsForPid is scoped to a single pid. Reading one offering -
  // which is what a welcome-team page would naturally copy from the family-scoped
  // callers - silently omits an entire centre's classes from a page whose whole
  // job is showing every visitor.
  it('reads the levels of EVERY open Bala Vihar offering, not just one', async () => {
    getOpenOfferings.mockResolvedValue([offering('bv-brampton-2026-27', 'Brampton'), offering('bv-scarborough-2026-27', 'Scarborough')]);
    fetchEnabledLevelsForPid.mockImplementation(async (pid: string) =>
      pid === 'bv-brampton-2026-27' ? [level('b2', 'Level 2', ['2'])] : [level('s2', 'Level 2', ['2'])],
    );
    readPortalGuestChildren.mockResolvedValue([child('Arjun', '2')]);

    const view = await getAllVisitorsView(SUNDAY);

    expect(fetchEnabledLevelsForPid).toHaveBeenCalledTimes(2);
    expect(view.groups.map((g) => g.location).sort()).toEqual(['Brampton', 'Scarborough']);
  });

  // The location filter must be OMITTED, not passed as null. `getOpenOfferings`
  // distinguishes the two: undefined means "no location filter at all", while
  // null means "location-less offerings only" - which would return nothing,
  // because every Bala Vihar offering is bound to a centre.
  it('asks for offerings with no location filter at all', async () => {
    await getAllVisitorsView(SUNDAY);
    expect(getOpenOfferings).toHaveBeenCalledWith({ programKey: 'bala-vihar' });
    expect(getOpenOfferings.mock.calls[0]![0]).not.toHaveProperty('location');
  });
});

describe('getAllVisitorsView - grouping', () => {
  beforeEach(() => {
    getOpenOfferings.mockResolvedValue([offering('bv-brampton-2026-27', 'Brampton')]);
    fetchEnabledLevelsForPid.mockResolvedValue([
      level('b1', 'Level 1', ['1']),
      level('b2', 'Level 2', ['2']),
    ]);
  });

  it('merges both door sources', async () => {
    readDoorGuestCheckIns.mockResolvedValue([child('Legacy', '1')]);
    readPortalGuestChildren.mockResolvedValue([child('Portal', '1')]);
    const view = await getAllVisitorsView(SUNDAY);
    expect(view.groups[0]!.children.map((c) => c.name).sort()).toEqual(['Legacy', 'Portal']);
  });

  it('normalizes the date for the portal source but not the legacy one', async () => {
    // Portal guest docs are keyed to the week's Sunday; the legacy door keeps its
    // own raw calendar-day key. Passing the same string to both would make one of
    // them match nothing.
    await getAllVisitorsView('2026-09-16'); // a Wednesday
    expect(readDoorGuestCheckIns).toHaveBeenCalledWith('2026-09-16');
    expect(readPortalGuestChildren).toHaveBeenCalledWith('2026-09-13');
  });

  it('omits classes nobody visited', async () => {
    readPortalGuestChildren.mockResolvedValue([child('Arjun', '2')]);
    const view = await getAllVisitorsView(SUNDAY);
    expect(view.groups.map((g) => g.levelId)).toEqual(['b2']);
  });

  // A guest with a blank or unmatched grade is invisible to every teacher screen
  // (guestMatchesLevel returns false for both). On a page whose purpose is "who
  // is here today", dropping them silently is the same failure as dropping a
  // centre - so they get their own bucket instead.
  it('keeps a child whose grade matches no class instead of dropping them', async () => {
    readPortalGuestChildren.mockResolvedValue([child('Arjun', '2'), child('Nobody', '11'), child('Blank', '')]);
    const view = await getAllVisitorsView(SUNDAY);
    expect(view.groups.flatMap((g) => g.children.map((c) => c.name))).toEqual(['Arjun']);
    expect(view.unmatched.map((c) => c.name).sort()).toEqual(['Blank', 'Nobody']);
  });

  // A door guest's centre is not recorded by EITHER source, so a grade-2 child
  // matches Level 2 at both centres and we cannot say which they attended. They
  // appear under both - the same thing each centre's teacher already sees - but
  // the headline count must not double them.
  it('counts a child once even when they match classes at two centres', async () => {
    getOpenOfferings.mockResolvedValue([offering('bv-brampton-2026-27', 'Brampton'), offering('bv-scarborough-2026-27', 'Scarborough')]);
    fetchEnabledLevelsForPid.mockImplementation(async (pid: string) =>
      pid === 'bv-brampton-2026-27' ? [level('b2', 'Level 2', ['2'])] : [level('s2', 'Level 2', ['2'])],
    );
    readPortalGuestChildren.mockResolvedValue([child('Arjun', '2')]);

    const view = await getAllVisitorsView(SUNDAY);
    expect(view.groups).toHaveLength(2);
    expect(view.childCount).toBe(1);
  });

  it('reports zero of everything for a day with no guests', async () => {
    const view = await getAllVisitorsView(SUNDAY);
    expect(view).toMatchObject({ date: SUNDAY, groups: [], unmatched: [], childCount: 0 });
  });

  it('orders groups by centre, then by class', async () => {
    getOpenOfferings.mockResolvedValue([offering('bv-scarborough-2026-27', 'Scarborough'), offering('bv-brampton-2026-27', 'Brampton')]);
    fetchEnabledLevelsForPid.mockImplementation(async (pid: string) =>
      pid === 'bv-brampton-2026-27'
        ? [level('b2', 'Level 2', ['2']), level('b1', 'Level 1', ['1'])]
        : [level('s1', 'Level 1', ['1'])],
    );
    readPortalGuestChildren.mockResolvedValue([child('A', '1'), child('B', '2')]);

    const view = await getAllVisitorsView(SUNDAY);
    expect(view.groups.map((g) => `${g.location}/${g.levelName}`)).toEqual([
      'Brampton/Level 1',
      'Brampton/Level 2',
      'Scarborough/Level 1',
    ]);
  });
});
