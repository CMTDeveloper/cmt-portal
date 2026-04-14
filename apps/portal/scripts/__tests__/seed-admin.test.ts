import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  getOrCreateAdminUser: vi.fn(),
}));

import { getOrCreateAdminUser } from '@cmt/firebase-shared/admin/claims';
import { seedAdmin } from '../seed-admin';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('seedAdmin', () => {
  it('delegates to getOrCreateAdminUser with email+password', async () => {
    (getOrCreateAdminUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'new-uid',
      email: 'admin@example.com',
    });
    const result = await seedAdmin({ email: 'admin@example.com', password: 'p@ssword123' });
    expect(getOrCreateAdminUser).toHaveBeenCalledWith('admin@example.com', 'p@ssword123');
    expect(result.uid).toBe('new-uid');
    expect(result.email).toBe('admin@example.com');
  });

  it('throws when email is invalid', async () => {
    await expect(seedAdmin({ email: 'not-email', password: 'x' })).rejects.toThrow(/email/);
  });

  it('throws when password is shorter than 8 chars', async () => {
    await expect(
      seedAdmin({ email: 'admin@example.com', password: 'short' }),
    ).rejects.toThrow(/password/);
  });
});
