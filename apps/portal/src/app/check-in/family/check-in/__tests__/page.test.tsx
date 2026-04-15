import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('/check-in/family/check-in page — flag-off branch', () => {
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
    vi.doMock('@/features/check-in/shared', () => ({
      findFamilyById: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('@/features/check-in/family', () => ({
      StudentCheckInList: vi.fn().mockReturnValue(null),
    }));

    const { default: FamilySelfCheckInPage } = await import('../page');

    await expect(FamilySelfCheckInPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundSpy).toHaveBeenCalled();
  });
});
