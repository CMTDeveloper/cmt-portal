import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── next/cache ────────────────────────────────────────────────────────────────
vi.mock('next/cache', () => ({
  unstable_cacheTag: vi.fn(),
  unstable_cacheLife: vi.fn(),
}));

// ── Firestore ─────────────────────────────────────────────────────────────────
const mockDocGet = vi.hoisted(() => vi.fn());
const mockCollectionGet = vi.hoisted(() => vi.fn());

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const makeDoc = (id: string, getFn: ReturnType<typeof vi.fn>) => ({
    id,
    get: getFn,
  });

  return {
    portalFirestore: vi.fn(() => ({
      collection: vi.fn().mockImplementation((_name: string) => ({
        doc: vi.fn().mockImplementation((_id?: string) => makeDoc(_id ?? 'auto-id', mockDocGet)),
        get: mockCollectionGet,
        orderBy: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      })),
    })),
  };
});

// ── Import under test (AFTER mocks) ───────────────────────────────────────────
import { getProgram, listPrograms, assertProgramActive } from '../get-programs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date();

function makeProgramData(overrides: Record<string, unknown> = {}) {
  return {
    programKey: 'bala-vihar',
    label: 'Bala Vihar',
    shortDescription: 'Sunday Bala Vihar classes',
    status: 'active',
    locations: ['Brampton', 'Mississauga'],
    termType: 'term',
    eligibility: { memberType: 'child' },
    capabilities: {
      usesOfferings: true,
      usesDonation: true,
      usesLevels: true,
      usesCalendar: true,
      attendanceMode: 'check-in',
    },
    displayOrder: 0,
    createdAt: { toDate: () => NOW },
    createdBy: 'migration',
    updatedAt: { toDate: () => NOW },
    updatedBy: 'migration',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// getProgram
// ─────────────────────────────────────────────────────────────────────────────

describe('getProgram', () => {
  it('returns a ProgramDoc when the doc exists', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => makeProgramData(),
    });

    const result = await getProgram('bala-vihar');
    expect(result).not.toBeNull();
    expect(result?.programKey).toBe('bala-vihar');
    expect(result?.label).toBe('Bala Vihar');
    expect(result?.status).toBe('active');
    expect(result?.createdAt).toBeInstanceOf(Date);
    expect(result?.updatedAt).toBeInstanceOf(Date);
  });

  it('returns null when the doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const result = await getProgram('missing-program');
    expect(result).toBeNull();
  });

  it('maps eligibility and capabilities correctly', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => makeProgramData(),
    });

    const result = await getProgram('bala-vihar');
    expect(result?.eligibility.memberType).toBe('child');
    expect(result?.capabilities.usesOfferings).toBe(true);
    expect(result?.capabilities.attendanceMode).toBe('check-in');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listPrograms
// ─────────────────────────────────────────────────────────────────────────────

describe('listPrograms', () => {
  it('returns programs ordered by displayOrder', async () => {
    const bv = makeProgramData({ programKey: 'bala-vihar', displayOrder: 0 });
    const tabla = makeProgramData({ programKey: 'tabla', label: 'Tabla', displayOrder: 1 });

    mockCollectionGet.mockResolvedValue({
      docs: [
        { data: () => bv },
        { data: () => tabla },
      ],
    });

    const results = await listPrograms();
    expect(results).toHaveLength(2);
    expect(results[0]?.programKey).toBe('bala-vihar');
    expect(results[1]?.programKey).toBe('tabla');
  });

  it('returns empty array when no programs exist', async () => {
    mockCollectionGet.mockResolvedValue({ docs: [] });

    const results = await listPrograms();
    expect(results).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assertProgramActive
// ─────────────────────────────────────────────────────────────────────────────

describe('assertProgramActive', () => {
  it('resolves with the ProgramDoc when status is active', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => makeProgramData({ status: 'active' }),
    });

    const result = await assertProgramActive('bala-vihar');
    expect(result.programKey).toBe('bala-vihar');
    expect(result.status).toBe('active');
  });

  it('throws "program-not-available" when program does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await expect(assertProgramActive('missing')).rejects.toThrow('program-not-available');
  });

  it('throws "program-not-available" when status is draft', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => makeProgramData({ status: 'draft' }),
    });

    await expect(assertProgramActive('bala-vihar')).rejects.toThrow('program-not-available');
  });

  it('throws "program-not-available" when status is archived', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => makeProgramData({ status: 'archived' }),
    });

    await expect(assertProgramActive('bala-vihar')).rejects.toThrow('program-not-available');
  });
});
