import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RolloverReport, StartYearResult, YearReadiness } from '@cmt/shared-domain';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

// portalFirestore is only passed through to the (mocked) engines.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ __db: true })),
}));

const mockStartNewYear = vi.fn();
vi.mock('@/features/setu/rollover/start-new-year', () => ({
  startNewYear: (...a: unknown[]) => mockStartNewYear(...a),
}));

const mockPromoteFamilies = vi.fn();
vi.mock('@/features/setu/rollover/promote-families', () => ({
  promoteFamilies: (...a: unknown[]) => mockPromoteFamilies(...a),
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

const READINESS: YearReadiness = {
  toYear: '2026-27',
  promotionRan: false,
  offerings: true,
  levels: true,
  calendar: false,
  teachers: false,
  prasad: false,
  seva: false,
};

const START_RESULT: StartYearResult = {
  fromYear: '2025-26',
  toYear: '2026-27',
  offeringsCreated: ['bala-vihar-brampton-2026-27'],
  offeringsExisting: [],
  levelsCreated: ['bala-vihar-brampton-2026-27-grade-1'],
  levelsExisting: [],
  donationPeriodsCreated: ['bala-vihar-brampton-2026-27'],
};

const REPORT: RolloverReport = {
  fromYear: '2025-26',
  toYear: '2026-27',
  dryRun: true,
  familiesProcessed: 2,
  familiesSkippedAlreadyPromoted: 0,
  promoted: 2,
  advanced: 2,
  shishuStayed: 0,
  graduated: 0,
  needsAttention: 0,
  byTransition: [{ label: 'Grade 1 → Grade 2', count: 2 }],
  graduates: [],
  attention: [],
  affectedFids: [],
  rows: [
    {
      fid: 'CMT-0001', mid: 'CMT-0001-02', childName: 'A Child',
      location: 'Brampton', outcomeKind: 'advance',
      fromGrade: '1', fromLevelName: 'Grade 1', toGrade: '2', toLevelName: 'Grade 2',
    },
    {
      fid: 'CMT-0002', mid: 'CMT-0002-02', childName: 'B Child',
      location: 'Brampton', outcomeKind: 'advance',
      fromGrade: '1', fromLevelName: 'Grade 1', toGrade: '2', toLevelName: 'Grade 2',
    },
  ],
};

function makeRequest(path: string, body?: unknown, role?: string, uid = 'uid-admin', method = 'POST'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStartNewYear.mockResolvedValue(START_RESULT);
  mockPromoteFamilies.mockResolvedValue(REPORT);
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
  mockSetSchoolYearConfig.mockResolvedValue({ currentYear: '2026-27' });
  mockComputeYearReadiness.mockResolvedValue(READINESS);
});

// ── GET/PUT /api/admin/school-year ─────────────────────────────────────────────

describe('GET /api/admin/school-year', () => {
  it('returns 403 when no session header', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('/api/admin/school-year', undefined, undefined, 'uid-admin', 'GET'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockGetSchoolYearConfig).not.toHaveBeenCalled();
  });

  it('returns the configured current year, derived next year, and readiness for admin', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('/api/admin/school-year', undefined, 'admin', 'uid-admin', 'GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      config: { currentYear: '2025-26' },
      nextYear: '2026-27',
      readiness: READINESS,
    });
    expect(mockComputeYearReadiness).toHaveBeenCalledWith(expect.anything(), {
      fromYear: '2025-26',
      toYear: '2026-27',
    });
  });
});

describe('PUT /api/admin/school-year', () => {
  it('returns 403 for a non-admin role', async () => {
    const { PUT } = await import('../route');
    const res = await PUT(makeRequest('/api/admin/school-year', { currentYear: '2026-27' }, 'family-manager', 'uid-family', 'PUT'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockSetSchoolYearConfig).not.toHaveBeenCalled();
  });

  it('persists a valid current year and revalidates the page', async () => {
    const { revalidatePath } = await import('next/cache');
    const { PUT } = await import('../route');
    const res = await PUT(makeRequest('/api/admin/school-year', { currentYear: '2026-27' }, 'admin', 'uid-admin', 'PUT'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: { currentYear: '2026-27' }, nextYear: '2027-28' });
    expect(mockSetSchoolYearConfig).toHaveBeenCalledWith(expect.anything(), { currentYear: '2026-27' }, 'uid-admin');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/school-year');
  });

  it('returns 400 for an invalid school year label', async () => {
    const { PUT } = await import('../route');
    const res = await PUT(makeRequest('/api/admin/school-year', { currentYear: '2026' }, 'admin', 'uid-admin', 'PUT'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad-request');
    expect(mockSetSchoolYearConfig).not.toHaveBeenCalled();
  });
});

// ── POST /api/admin/school-year/start ──────────────────────────────────────────

describe('POST /api/admin/school-year/start', () => {
  it('returns 403 when no session header', async () => {
    const { POST } = await import('../start/route');
    const res = await POST(makeRequest('/api/admin/school-year/start', {}));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockStartNewYear).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin (family) role', async () => {
    const { POST } = await import('../start/route');
    const res = await POST(makeRequest('/api/admin/school-year/start', {}, 'family-manager'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockStartNewYear).not.toHaveBeenCalled();
  });

  it('runs startNewYear with dryRun:false + an actorMid and returns the result', async () => {
    const { POST } = await import('../start/route');
    const res = await POST(makeRequest('/api/admin/school-year/start', {}, 'admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(START_RESULT);
    expect(mockStartNewYear).toHaveBeenCalledTimes(1);
    const args = mockStartNewYear.mock.calls[0]![1] as { dryRun: boolean; actorMid: string };
    expect(args.dryRun).toBe(false);
    expect(typeof args.actorMid).toBe('string');
    expect(args.actorMid.length).toBeGreaterThan(0);
  });

  it('forwards fromYear/toYear from the body', async () => {
    const { POST } = await import('../start/route');
    await POST(makeRequest('/api/admin/school-year/start', { fromYear: '2024-25', toYear: '2025-26' }, 'admin'));
    const args = mockStartNewYear.mock.calls[0]![1] as { fromYear?: string; toYear?: string };
    expect(args.fromYear).toBe('2024-25');
    expect(args.toYear).toBe('2025-26');
  });

  it('revalidates offerings + levels tags on success', async () => {
    const { revalidateTag } = await import('next/cache');
    const { POST } = await import('../start/route');
    await POST(makeRequest('/api/admin/school-year/start', {}, 'admin'));
    expect(revalidateTag).toHaveBeenCalledWith('offerings', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('levels', 'max');
  });

  it('returns 400 when the body is invalid (non-string fromYear)', async () => {
    const { POST } = await import('../start/route');
    const res = await POST(makeRequest('/api/admin/school-year/start', { fromYear: 42 }, 'admin'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
    expect(mockStartNewYear).not.toHaveBeenCalled();
  });
});

// ── POST /api/admin/school-year/promote ─────────────────────────────────────────

describe('POST /api/admin/school-year/promote', () => {
  it('returns 403 for a non-admin (family) role', async () => {
    const { POST } = await import('../promote/route');
    const res = await POST(makeRequest('/api/admin/school-year/promote', { dryRun: true }, 'family-manager'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(mockPromoteFamilies).not.toHaveBeenCalled();
  });

  it('runs promoteFamilies with dryRun:true and returns the report (no revalidation)', async () => {
    const { revalidateTag } = await import('next/cache');
    const { POST } = await import('../promote/route');
    const res = await POST(makeRequest('/api/admin/school-year/promote', { dryRun: true }, 'admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REPORT);
    expect(mockPromoteFamilies).toHaveBeenCalledTimes(1);
    const args = mockPromoteFamilies.mock.calls[0]![1] as { dryRun: boolean; actorMid: string };
    expect(args.dryRun).toBe(true);
    expect(typeof args.actorMid).toBe('string');
    // Dry-run writes nothing → no cache invalidation.
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('revalidates family-${fid} from affectedFids (not capped rows) on a commit run', async () => {
    // affectedFids is the uncapped source of truth — revalidation must derive from
    // it, not from `rows` (which the engine caps at COMMIT_ROW_CAP).
    mockPromoteFamilies.mockResolvedValueOnce({ ...REPORT, dryRun: false, affectedFids: ['F1'] });
    const { revalidateTag } = await import('next/cache');
    const { POST } = await import('../promote/route');
    const res = await POST(makeRequest('/api/admin/school-year/promote', { dryRun: false }, 'admin'));
    expect(res.status).toBe(200);
    const args = mockPromoteFamilies.mock.calls[0]![1] as { dryRun: boolean };
    expect(args.dryRun).toBe(false);
    expect(revalidateTag).toHaveBeenCalledWith('family-F1', 'max');
    // CMT-0001/CMT-0002 appear in rows but NOT in affectedFids → not revalidated.
    expect(revalidateTag).not.toHaveBeenCalledWith('family-CMT-0001', 'max');
  });

  it('returns 400 when dryRun is missing from the body', async () => {
    const { POST } = await import('../promote/route');
    const res = await POST(makeRequest('/api/admin/school-year/promote', {}, 'admin'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
    expect(mockPromoteFamilies).not.toHaveBeenCalled();
  });
});
