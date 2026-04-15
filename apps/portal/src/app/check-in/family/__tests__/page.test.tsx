import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('/check-in/family page — flag-off branch', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY;
  });

  it('calls notFound when checkInFamily flag is off', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN = 'true';
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY = 'false';

    const notFoundSpy = vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    });

    vi.doMock('next/navigation', () => ({ notFound: notFoundSpy }));
    vi.doMock('next/headers', () => ({
      headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue('42') }),
    }));
    vi.doMock('@cmt/firebase-shared/admin/rtdb', () => ({ readRtdb: vi.fn().mockResolvedValue(null) }));
    vi.doMock('@cmt/firebase-shared/admin/firestore', () => ({ readFirestore: vi.fn().mockResolvedValue([]) }));
    vi.doMock('@/features/check-in/shared', () => ({
      findFamilyById: vi.fn().mockResolvedValue(null),
      loadRecentFamilyCheckIns: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('@/features/check-in/family', () => ({
      FamilyDashboard: vi.fn().mockReturnValue(null),
    }));

    const { default: FamilyDashboardPage } = await import('../page');

    await expect(FamilyDashboardPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundSpy).toHaveBeenCalled();
  });
});
