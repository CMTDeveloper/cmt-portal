import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockDocGet, whereCalls } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockDocGet: vi.fn(),
  whereCalls: [] as unknown[][],
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const Timestamp = { now: () => ({ toDate: () => new Date() }) };
  const record = (...args: unknown[]) => {
    whereCalls.push(args);
    return whereChain;
  };
  const orderByChain = { orderBy: () => orderByChain, get: mockGet };
  const whereChain = { where: record, orderBy: () => orderByChain, get: mockGet };
  return {
    Timestamp,
    portalFirestore: () => ({
      collection: () => ({
        where: record,
        doc: () => ({ get: mockDocGet }),
      }),
    }),
  };
});

import { getUpcoming, getPublishedCalendar, getWeeklySchedule, torontoToday, mostRecentSunday } from '../calendar';

function entryDoc(date: string, kind: 'class' | 'no-class', enabled = true, extra: Record<string, unknown> = {}) {
  return {
    data: () => ({
      entryId: `brampton-${date}`,
      programKey: 'bala-vihar',
      location: 'Brampton',
      date,
      kind,
      classType: kind === 'class' ? 'regular' : null,
      noClassReason: kind === 'no-class' ? 'Winter Break' : null,
      specialEvents: null,
      enabled,
      createdBy: 'a',
      updatedBy: 'a',
      ...extra,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  whereCalls.length = 0;
});

describe('torontoToday', () => {
  it('formats a date as YYYY-MM-DD in Toronto', () => {
    // 2026-01-15 05:00 UTC = 2026-01-15 00:00 Toronto (EST)
    expect(torontoToday(new Date('2026-01-15T05:00:00Z'))).toBe('2026-01-15');
  });
});

describe('mostRecentSunday', () => {
  it('mostRecentSunday returns the same day when today is Sunday', () => {
    expect(mostRecentSunday(new Date('2026-01-04T17:00:00Z'))).toBe('2026-01-04'); // a Sunday
  });
  it('mostRecentSunday rolls back to the previous Sunday midweek', () => {
    expect(mostRecentSunday(new Date('2026-01-07T17:00:00Z'))).toBe('2026-01-04'); // Wed → prev Sun
  });
});

describe('getPublishedCalendar', () => {
  it('filters out disabled (draft) entries', async () => {
    mockGet.mockResolvedValue({
      docs: [entryDoc('2025-09-07', 'class', true), entryDoc('2025-09-14', 'class', false)],
    });
    const out = await getPublishedCalendar('Brampton', 'bala-vihar');
    expect(out).toHaveLength(1);
    expect(out[0]!.date).toBe('2025-09-07');
  });

  it('scopes the query to BOTH location and programKey (#2: no cross-program leak)', async () => {
    mockGet.mockResolvedValue({ docs: [] });
    await getPublishedCalendar('Brampton', 'tabla');
    // Without the programKey filter, a second usesCalendar program's dates leak
    // into a family's view and inflate the attendance denominator.
    expect(whereCalls).toContainEqual(['location', '==', 'Brampton']);
    expect(whereCalls).toContainEqual(['programKey', '==', 'tabla']);
  });
});

describe('getUpcoming', () => {
  it('returns the next class on/after today and a window of upcoming entries', async () => {
    mockGet.mockResolvedValue({
      docs: [
        entryDoc('2025-09-07', 'class', true),
        entryDoc('2025-10-12', 'no-class', true),
        entryDoc('2025-10-19', 'class', true),
        entryDoc('2025-10-26', 'class', true),
      ],
    });
    const { nextClass, upcoming } = await getUpcoming('Brampton', 'bala-vihar', '2025-10-10', 4);
    // next class on/after 2025-10-10 skips the 10-12 no-class day → 10-19
    expect(nextClass?.date).toBe('2025-10-19');
    // upcoming includes the no-class notice + classes from 2025-10-10 onward
    expect(upcoming.map((e) => e.date)).toEqual(['2025-10-12', '2025-10-19', '2025-10-26']);
  });

  it('returns null nextClass when nothing remains', async () => {
    mockGet.mockResolvedValue({ docs: [entryDoc('2025-09-07', 'class', true)] });
    const { nextClass, upcoming } = await getUpcoming('Brampton', 'bala-vihar', '2026-07-01');
    expect(nextClass).toBeNull();
    expect(upcoming).toEqual([]);
  });
});

describe('getWeeklySchedule', () => {
  it('returns [] when no doc exists', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    expect(await getWeeklySchedule('Brampton')).toEqual([]);
  });
  it('returns the rows from the doc', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ rows: [{ time: '10:00', label: 'Assembly' }] }) });
    expect(await getWeeklySchedule('Brampton')).toEqual([{ time: '10:00', label: 'Assembly' }]);
  });
});
