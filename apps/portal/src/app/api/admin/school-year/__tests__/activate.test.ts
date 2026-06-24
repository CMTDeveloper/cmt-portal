import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CalendarCopyResult, YearReadiness } from '@cmt/shared-domain';
import type { PrasadCopyResult } from '@/features/setu/rollover/clone-prasad-config';
import type { SevaCopyResult } from '@/features/setu/rollover/copy-seva-opportunities';
import type { TeacherPrefillResult } from '@/features/setu/rollover/prefill-teachers';

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

// The route delegates the atomic year+seva flip to this helper (a single
// Firestore transaction). The route test asserts the delegation + gate; the
// transaction itself is covered by activate-school-year.test.ts.
const mockActivateSchoolYear = vi.fn();
vi.mock('@/features/setu/rollover/activate-school-year', () => ({
  activateSchoolYear: (...a: unknown[]) => mockActivateSchoolYear(...a),
}));

const mockCloneCalendarYear = vi.fn();
vi.mock('@/features/setu/rollover/clone-calendar', () => ({
  cloneCalendarYear: (...a: unknown[]) => mockCloneCalendarYear(...a),
}));

const mockClonePrasadConfig = vi.fn();
vi.mock('@/features/setu/rollover/clone-prasad-config', () => ({
  clonePrasadConfig: (...a: unknown[]) => mockClonePrasadConfig(...a),
}));

const mockCopySevaOpportunities = vi.fn();
vi.mock('@/features/setu/rollover/copy-seva-opportunities', () => ({
  copySevaOpportunities: (...a: unknown[]) => mockCopySevaOpportunities(...a),
}));

const mockPrefillTeachers = vi.fn();
vi.mock('@/features/setu/rollover/prefill-teachers', () => ({
  prefillTeachers: (...a: unknown[]) => mockPrefillTeachers(...a),
}));

function makeRequest(path: string, role?: string, uid = 'uid-admin', mid?: string, body?: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  if (mid) headers['x-portal-mid'] = mid;
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
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

const PRASAD_RESULT: PrasadCopyResult = {
  fromYear: '2025-26',
  toYear: '2026-27',
  created: ['bv-brampton-2026-27'],
  existing: [],
};

const SEVA_RESULT: SevaCopyResult = {
  fromYear: '2025-26',
  toYear: '2026-27',
  created: ['opp-a-2026-27'],
  existing: [],
};

const TEACHER_RESULT: TeacherPrefillResult = {
  fromYear: '2025-26',
  toYear: '2026-27',
  filled: ['brampton-grade1-bv-brampton-2026-27'],
  skipped: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
  mockSetSchoolYearConfig.mockResolvedValue({ currentYear: '2026-27' });
  mockComputeYearReadiness.mockResolvedValue(READINESS_PROMOTED);
  mockGetSevaRequirement.mockResolvedValue({ hoursPerYear: 20, currentSevaYear: '2025-26' });
  mockSetSevaRequirement.mockResolvedValue(undefined);
  mockActivateSchoolYear.mockResolvedValue({ config: { currentYear: '2026-27' }, sevaYear: '2026-27' });
  mockCloneCalendarYear.mockResolvedValue(CALENDAR_RESULT);
  mockClonePrasadConfig.mockResolvedValue(PRASAD_RESULT);
  mockCopySevaOpportunities.mockResolvedValue(SEVA_RESULT);
  mockPrefillTeachers.mockResolvedValue(TEACHER_RESULT);
});

// ── POST /api/admin/school-year/activate ────────────────────────────────────────

describe('POST /api/admin/school-year/activate', () => {
  it('returns 403 when no session header', async () => {
    const { POST } = await import('../activate/route');
    const res = await POST(makeRequest('/api/admin/school-year/activate', undefined));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockActivateSchoolYear).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin role', async () => {
    const { POST } = await import('../activate/route');
    const res = await POST(makeRequest('/api/admin/school-year/activate', 'family-member'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockActivateSchoolYear).not.toHaveBeenCalled();
  });

  it('blocks Activate when promotion has not run', async () => {
    mockComputeYearReadiness.mockResolvedValue({ ...READINESS_PROMOTED, promotionRan: false });
    const { POST } = await import('../activate/route');
    const res = await POST(makeRequest('/api/admin/school-year/activate', 'admin'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('promotion-not-run');
    expect(mockActivateSchoolYear).not.toHaveBeenCalled();
  });

  it('flips currentYear AND currentSevaYear on success (delegates to the atomic helper)', async () => {
    const { POST } = await import('../activate/route');
    const res = await POST(makeRequest('/api/admin/school-year/activate', 'admin', 'uid-admin', 'A1'));
    expect(res.status).toBe(200);
    expect(mockActivateSchoolYear).toHaveBeenCalledWith(expect.anything(), { toYear: '2026-27', actorMid: 'A1' });
    expect(await res.json()).toEqual({ config: { currentYear: '2026-27' }, sevaYear: '2026-27' });
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

// ── POST /api/admin/school-year/copy-prasad ─────────────────────────────────────

describe('POST /api/admin/school-year/copy-prasad', () => {
  it('returns 403 for a non-admin role', async () => {
    const { POST } = await import('../copy-prasad/route');
    const res = await POST(makeRequest('/api/admin/school-year/copy-prasad', 'family-member'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockClonePrasadConfig).not.toHaveBeenCalled();
  });

  it('clones the prasad config from current → next year with the actor mid and returns the result', async () => {
    const { POST } = await import('../copy-prasad/route');
    const res = await POST(makeRequest('/api/admin/school-year/copy-prasad', 'admin', 'uid-admin', 'A1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PRASAD_RESULT);
    expect(mockClonePrasadConfig).toHaveBeenCalledWith(expect.anything(), {
      fromYear: '2025-26',
      toYear: '2026-27',
      dryRun: false,
      actorMid: 'A1',
    });
  });
});

// ── POST /api/admin/school-year/copy-teachers ───────────────────────────────────

describe('POST /api/admin/school-year/copy-teachers', () => {
  it('returns 403 for a non-admin role', async () => {
    const { POST } = await import('../copy-teachers/route');
    const res = await POST(makeRequest('/api/admin/school-year/copy-teachers', 'family-member'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockPrefillTeachers).not.toHaveBeenCalled();
  });

  it('pre-fills teachers from current → next year with the actor mid and returns the result', async () => {
    const { POST } = await import('../copy-teachers/route');
    const res = await POST(makeRequest('/api/admin/school-year/copy-teachers', 'admin', 'uid-admin', 'A1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TEACHER_RESULT);
    expect(mockPrefillTeachers).toHaveBeenCalledWith(expect.anything(), {
      fromYear: '2025-26',
      toYear: '2026-27',
      dryRun: false,
      actorMid: 'A1',
    });
  });
});

// ── POST /api/admin/school-year/copy-seva ───────────────────────────────────────

describe('POST /api/admin/school-year/copy-seva', () => {
  it('returns 403 for a non-admin role', async () => {
    const { POST } = await import('../copy-seva/route');
    const res = await POST(
      makeRequest('/api/admin/school-year/copy-seva', 'family-member', 'uid-admin', undefined, {
        oppIds: ['opp-a'],
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockCopySevaOpportunities).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is missing oppIds', async () => {
    const { POST } = await import('../copy-seva/route');
    const res = await POST(
      makeRequest('/api/admin/school-year/copy-seva', 'admin', 'uid-admin', 'A1', { decideLater: true }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad-request');
    expect(mockCopySevaOpportunities).not.toHaveBeenCalled();
  });

  it('copies the selected opps with the actor mid and returns the result', async () => {
    const { POST } = await import('../copy-seva/route');
    const res = await POST(
      makeRequest('/api/admin/school-year/copy-seva', 'admin', 'uid-admin', 'A1', {
        oppIds: ['opp-a'],
        decideLater: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SEVA_RESULT);
    expect(mockCopySevaOpportunities).toHaveBeenCalledWith(expect.anything(), {
      fromYear: '2025-26',
      toYear: '2026-27',
      oppIds: ['opp-a'],
      decideLater: true,
      actorMid: 'A1',
    });
  });

  it('defaults decideLater to false when omitted', async () => {
    const { POST } = await import('../copy-seva/route');
    const res = await POST(
      makeRequest('/api/admin/school-year/copy-seva', 'admin', 'uid-admin', 'A1', { oppIds: ['opp-a'] }),
    );
    expect(res.status).toBe(200);
    expect(mockCopySevaOpportunities).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decideLater: false }),
    );
  });
});
