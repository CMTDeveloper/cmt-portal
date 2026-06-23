import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CalendarCopyResult, YearReadiness } from '@cmt/shared-domain';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ __db: true })),
}));

const mockGetSchoolYearConfig = vi.fn();
const mockSetSchoolYearConfig = vi.fn();
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: (...a: unknown[]) => mockGetSchoolYearConfig(...a),
  setSchoolYearConfig: (...a: unknown[]) => mockSetSchoolYearConfig(...a),
}));

const mockComputeYearReadiness = vi.fn();
vi.mock('@/features/setu/rollover/year-readiness', () => ({
  computeYearReadiness: (...a: unknown[]) => mockComputeYearReadiness(...a),
}));

const mockGetSevaRequirement = vi.fn();
const mockSetSevaRequirement = vi.fn();
vi.mock('@/lib/seva-requirement', () => ({
  getSevaRequirement: (...a: unknown[]) => mockGetSevaRequirement(...a),
  setSevaRequirement: (...a: unknown[]) => mockSetSevaRequirement(...a),
}));

const mockCloneCalendarYear = vi.fn();
vi.mock('@/features/setu/rollover/clone-calendar', () => ({
  cloneCalendarYear: (...a: unknown[]) => mockCloneCalendarYear(...a),
}));

function makeRequest(path: string, role?: string, uid = 'uid-admin', mid?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  if (mid) headers['x-portal-mid'] = mid;
  return new Request(`http://localhost${path}`, { method: 'POST', headers });
}

const READINESS_PROMOTED: YearReadiness = {
  toYear: '2026-27',
  promotionRan: true,
  offerings: true,
  levels: true,
  calendar: true,
  teachers: true,
  prasad: true,
  seva: true,
};

const CALENDAR_RESULT: CalendarCopyResult = {
  fromYear: '2025-26',
  toYear: '2026-27',
  created: ['bala-vihar-brampton-2026-09-13'],
  existing: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
  mockSetSchoolYearConfig.mockResolvedValue({ currentYear: '2026-27' });
  mockComputeYearReadiness.mockResolvedValue(READINESS_PROMOTED);
  mockGetSevaRequirement.mockResolvedValue({ hoursPerYear: 20, currentSevaYear: '2025-26' });
  mockSetSevaRequirement.mockResolvedValue(undefined);
  mockCloneCalendarYear.mockResolvedValue(CALENDAR_RESULT);
});

// ── POST /api/admin/school-year/activate ────────────────────────────────────────

describe('POST /api/admin/school-year/activate', () => {
  it('returns 403 when no session header', async () => {
    const { POST } = await import('../activate/route');
    const res = await POST(makeRequest('/api/admin/school-year/activate', undefined));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockSetSchoolYearConfig).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin role', async () => {
    const { POST } = await import('../activate/route');
    const res = await POST(makeRequest('/api/admin/school-year/activate', 'family-member'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockSetSchoolYearConfig).not.toHaveBeenCalled();
    expect(mockSetSevaRequirement).not.toHaveBeenCalled();
  });

  it('blocks Activate when promotion has not run', async () => {
    mockComputeYearReadiness.mockResolvedValue({ ...READINESS_PROMOTED, promotionRan: false });
    const { POST } = await import('../activate/route');
    const res = await POST(makeRequest('/api/admin/school-year/activate', 'admin'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('promotion-not-run');
    expect(mockSetSchoolYearConfig).not.toHaveBeenCalled();
    expect(mockSetSevaRequirement).not.toHaveBeenCalled();
  });

  it('flips currentYear AND currentSevaYear on success', async () => {
    const { POST } = await import('../activate/route');
    const res = await POST(makeRequest('/api/admin/school-year/activate', 'admin', 'uid-admin', 'A1'));
    expect(res.status).toBe(200);
    expect(mockSetSchoolYearConfig).toHaveBeenCalledWith(expect.anything(), { currentYear: '2026-27' }, 'A1');
    expect(mockSetSevaRequirement).toHaveBeenCalledWith(
      expect.objectContaining({ currentSevaYear: '2026-27', hoursPerYear: 20 }),
    );
  });

  it('revalidates the school-year tag and Year-center path on success', async () => {
    const { revalidateTag, revalidatePath } = await import('next/cache');
    const { POST } = await import('../activate/route');
    await POST(makeRequest('/api/admin/school-year/activate', 'admin', 'uid-admin', 'A1'));
    expect(revalidateTag).toHaveBeenCalledWith('school-year', 'max');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/school-year');
  });
});

// ── POST /api/admin/school-year/copy-calendar ───────────────────────────────────

describe('POST /api/admin/school-year/copy-calendar', () => {
  it('returns 403 for a non-admin role', async () => {
    const { POST } = await import('../copy-calendar/route');
    const res = await POST(makeRequest('/api/admin/school-year/copy-calendar', 'family-member'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockCloneCalendarYear).not.toHaveBeenCalled();
  });

  it('clones the calendar from current → next year and returns the result', async () => {
    const { POST } = await import('../copy-calendar/route');
    const res = await POST(makeRequest('/api/admin/school-year/copy-calendar', 'admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CALENDAR_RESULT);
    expect(mockCloneCalendarYear).toHaveBeenCalledWith(expect.anything(), {
      fromYear: '2025-26',
      toYear: '2026-27',
      dryRun: false,
    });
  });
});
