import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { listClasses, getRosterForClass } from '../rtdb/classlist';

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
