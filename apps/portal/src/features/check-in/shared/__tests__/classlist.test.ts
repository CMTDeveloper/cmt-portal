import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { listClasses, getRosterForClass, getRosterWithContacts } from '../rtdb/classlist';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listClasses', () => {
  it('returns classes from /classes path with student counts', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      K: { name: 'Kindergarten', studentIds: ['1', '2'] },
      G1: { name: 'Grade 1', studentIds: ['3'] },
    });
    const classes = await listClasses();
    expect(readRtdb).toHaveBeenCalledWith('/classes');
    expect(classes).toHaveLength(2);
    const k = classes.find((c) => c.classId === 'K');
    expect(k?.studentCount).toBe(2);
    expect(k?.name).toBe('Kindergarten');
  });

  it('returns an empty array when no classes exist', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const classes = await listClasses();
    expect(classes).toEqual([]);
  });
});

describe('getRosterForClass', () => {
  it('returns the roster with student details', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ name: 'Kindergarten', studentIds: ['1', '2'] })
      .mockResolvedValueOnce({
        sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K',
      })
      .mockResolvedValueOnce({
        sid: '2', fid: '43', firstName: 'Bob', lastName: 'Bravo', level: 'K',
      });
    const roster = await getRosterForClass('K');
    expect(roster?.classId).toBe('K');
    expect(roster?.students).toHaveLength(2);
    expect(roster?.students[0]?.firstName).toBe('Alice');
  });

  it('returns null when class not found', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const roster = await getRosterForClass('X');
    expect(roster).toBeNull();
  });

  it('omits students that cannot be looked up', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ name: 'K', studentIds: ['1', '2'] })
      .mockResolvedValueOnce({
        sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K',
      })
      .mockResolvedValueOnce(null);  // student 2 is missing
    const roster = await getRosterForClass('K');
    expect(roster?.students).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getRosterWithContacts
// ---------------------------------------------------------------------------

/** Build a minimal legacy RTDB roster snapshot.
 *  studentRows: non-grade-99 rows for classId 'K'
 *  parentRows:  grade=99 rows keyed by fid
 */
function makeRoster(
  studentRows: Array<Record<string, unknown>>,
  parentRows: Array<Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  studentRows.forEach((r, i) => { out[`s${i}`] = r; });
  parentRows.forEach((r, i) => { out[`p${i}`] = r; });
  return out;
}

describe('getRosterWithContacts', () => {
  it('returns null when no student rows match the classId', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRoster(
        [{ sid: '1', fid: '10', fname: 'Alice', lname: 'Acme', level: 'G1', grade: 1, payment: 'paid' }],
        [{ fid: '10', grade: 99, pemail: 'alice@example.com', phphone: '4165550001' }],
      ),
    );
    const result = await getRosterWithContacts('K'); // 'K' does not match level 'G1'
    expect(result).toBeNull();
  });

  it('returns students with parent email and phone from grade=99 rows', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRoster(
        [{ sid: '1', fid: '10', fname: 'Alice', lname: 'Acme', level: 'K', grade: 1, payment: 'paid' }],
        [{ fid: '10', grade: 99, pemail: 'alice@example.com', phphone: '4165550001' }],
      ),
    );
    const result = await getRosterWithContacts('K');
    expect(result).not.toBeNull();
    expect(result!.students).toHaveLength(1);
    expect(result!.students[0]!.parentEmail).toBe('alice@example.com');
    expect(result!.students[0]!.parentPhone).toBe('4165550001');
  });

  it('handles missing parent contact gracefully by returning empty strings', async () => {
    // No grade=99 row for fid '10'
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRoster(
        [{ sid: '1', fid: '10', fname: 'Bob', lname: 'Bravo', level: 'K', grade: 2, payment: 'paid' }],
        [],
      ),
    );
    const result = await getRosterWithContacts('K');
    expect(result!.students[0]!.parentEmail).toBe('');
    expect(result!.students[0]!.parentPhone).toBe('');
  });

  it('correctly maps payment string "paid" to paymentStatus paid', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRoster(
        [{ sid: '1', fid: '10', fname: 'Alice', lname: 'Acme', level: 'K', grade: 1, payment: 'Paid' }],
        [],
      ),
    );
    const result = await getRosterWithContacts('K');
    expect(result!.students[0]!.paymentStatus).toBe('paid');
  });

  it('correctly maps payment string containing "unpaid" to paymentStatus unpaid', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRoster(
        [{ sid: '2', fid: '11', fname: 'Carol', lname: 'Cruz', level: 'K', grade: 1, payment: 'Unpaid' }],
        [],
      ),
    );
    const result = await getRosterWithContacts('K');
    expect(result!.students[0]!.paymentStatus).toBe('unpaid');
  });

  it('defaults paymentStatus to partial for unknown/empty payment field', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRoster(
        [{ sid: '3', fid: '12', fname: 'Dave', lname: 'Drake', level: 'K', grade: 1 }],
        [],
      ),
    );
    const result = await getRosterWithContacts('K');
    expect(result!.students[0]!.paymentStatus).toBe('partial');
  });

  it('filters out grade=99 parent rows from the student list', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRoster(
        [{ sid: '1', fid: '10', fname: 'Alice', lname: 'Acme', level: 'K', grade: 1, payment: 'paid' }],
        [{ fid: '10', grade: 99, pemail: 'alice@example.com', phphone: '4165550001' }],
      ),
    );
    const result = await getRosterWithContacts('K');
    // Only 1 student row; the parent grade=99 row must not appear in students[]
    expect(result!.students).toHaveLength(1);
    expect(result!.students.every((s) => s.sid !== '')).toBe(true);
  });

  it('aggregates contacts using the first grade=99 row per fid when duplicates exist', async () => {
    const roster: Record<string, Record<string, unknown>> = {
      s0: { sid: '1', fid: '10', fname: 'Alice', lname: 'Acme', level: 'K', grade: 1, payment: 'paid' },
      p0: { fid: '10', grade: 99, pemail: 'first@example.com', phphone: '111' },
      p1: { fid: '10', grade: 99, pemail: 'second@example.com', phphone: '222' },
    };
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(roster);
    const result = await getRosterWithContacts('K');
    // First encountered grade=99 row wins
    expect(result!.students[0]!.parentEmail).toBe('first@example.com');
  });
});
