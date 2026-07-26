import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setGradeStaffClient } from '../set-grade-staff-client';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ok() {
  return { ok: true, status: 200 };
}

describe('setGradeStaffClient', () => {
  it('PATCHes the staff member route with just the grade', async () => {
    fetchMock.mockResolvedValue(ok());

    await setGradeStaffClient({ fid: 'FAM001', mid: 'FAM001-02', schoolGrade: '5' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/welcome/families/FAM001/members/FAM001-02');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ schoolGrade: '5' });
  });

  it('refuses a grade that is not a GRADE_LADDER rung, without calling the network', async () => {
    // The admin endpoint validates the rung via SetMemberGradeBodySchema; the
    // generic member PATCH accepts any string, so dropping this check would let
    // an off-ladder grade reach the doc and break the next rollover preview
    // (decidePromotion cannot place a member that is not on the ladder).
    await expect(
      setGradeStaffClient({ fid: 'FAM001', mid: 'FAM001-02', schoolGrade: 'Grade 5' as never }),
    ).rejects.toThrow(/ladder/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-OK response so the caller can toast', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await expect(
      setGradeStaffClient({ fid: 'FAM001', mid: 'FAM001-02', schoolGrade: '5' }),
    ).rejects.toThrow(/403/);
  });

  it('escapes ids so a stray path character cannot re-target the request', async () => {
    fetchMock.mockResolvedValue(ok());

    await setGradeStaffClient({ fid: 'FAM/001', mid: 'FAM001-02', schoolGrade: '5' });

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/welcome/families/FAM%2F001/members/FAM001-02');
  });
});
