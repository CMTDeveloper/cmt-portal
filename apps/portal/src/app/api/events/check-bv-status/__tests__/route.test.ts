import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

// Mock flags
vi.mock('@/lib/flags', () => ({
  flags: { eventsRegister: true },
}));

// Mock rate limiter
vi.mock('@/features/events/shared/rate-limiter', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Mock family lookup
const mockFindFamilyById = vi.fn();
const mockFindFamilyByContact = vi.fn();
vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: (...args: unknown[]) => mockFindFamilyById(...args),
  findFamilyByContact: (...args: unknown[]) => mockFindFamilyByContact(...args),
}));

// Mock RTDB read for collectFamilyContactSet
vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn().mockResolvedValue(null),
  masterRtdb: vi.fn(() => ({
    ref: vi.fn(() => ({
      once: vi.fn().mockResolvedValue({ val: () => null }),
    })),
  })),
}));

import * as appHandler from '../route';

describe('POST /api/events/check-bv-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFamilyById.mockResolvedValue(null);
    mockFindFamilyByContact.mockResolvedValue(null);
  });

  it('returns isBvFamily true for BV family email', async () => {
    mockFindFamilyByContact.mockResolvedValue({
      fid: '42',
      name: 'Test Family',
      contacts: [{ type: 'email', value: 'bv@example.com' }],
      students: [],
      paymentStatus: 'paid',
    });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'bv@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(true);
      },
    });
  });

  it('returns isBvFamily false for non-BV email', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nonbv@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(false);
      },
    });
  });

  it('returns isBvFamily true with family contacts for valid family ID', async () => {
    mockFindFamilyById.mockResolvedValue({
      fid: '42',
      name: 'Test Family',
      contacts: [
        { type: 'email', value: 'parent@example.com' },
        { type: 'phone', value: '4165551234' },
      ],
      students: [],
      paymentStatus: 'paid',
    });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ familyId: '42' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(true);
        expect(data.familyEmails).toContain('parent@example.com');
        expect(data.familyPhones).toContain('4165551234');
      },
    });
  });

  it('returns isBvFamily false for unknown family ID', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ familyId: '99999' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(false);
      },
    });
  });

  it('returns 400 for missing email and familyId', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for invalid email format', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'not-an-email' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('defaults to non-BV when Firebase throws', async () => {
    mockFindFamilyByContact.mockRejectedValue(new Error('Firebase unavailable'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(false);
      },
    });
  });
});
