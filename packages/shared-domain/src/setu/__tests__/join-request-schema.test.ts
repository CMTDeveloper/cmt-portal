import { describe, it, expect } from 'vitest';
import { JoinRequestDocSchema } from '../schemas/join-request';

describe('JoinRequestDocSchema', () => {
  const validRequest = {
    token: 'tok_abc123',
    fid: 'CMT-FAM1',
    matchedMid: 'CMT-FAM1-02',
    requesterEmail: 'priya@example.com',
    requesterPhone: '+14165550101',
    requesterName: 'Priya Patel',
    status: 'pending' as const,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  };

  it('accepts a valid pending join request', () => {
    expect(JoinRequestDocSchema.safeParse(validRequest).success).toBe(true);
  });

  it('accepts all valid status values', () => {
    for (const status of ['pending', 'approved', 'declined'] as const) {
      expect(JoinRequestDocSchema.safeParse({ ...validRequest, status }).success).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(JoinRequestDocSchema.safeParse({ ...validRequest, status: 'cancelled' }).success).toBe(false);
  });

  it('accepts optional requesterPhone / requesterName omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { requesterPhone, requesterName, ...rest } = validRequest;
    expect(JoinRequestDocSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects a missing required field (matchedMid)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { matchedMid, ...rest } = validRequest;
    expect(JoinRequestDocSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a missing required field (token)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { token, ...rest } = validRequest;
    expect(JoinRequestDocSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-Date createdAt', () => {
    expect(
      JoinRequestDocSchema.safeParse({ ...validRequest, createdAt: '2026-06-22T00:00:00.000Z' }).success,
    ).toBe(false);
  });
});
