import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/lib/flags', () => ({
  flags: { eventsRegister: true },
}));

vi.mock('@/features/events/shared/rate-limiter', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const mockCreate = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/events/shared/firestore-adapter', () => ({
  registrationsCollection: () => ({
    doc: () => ({
      create: mockCreate,
    }),
  }),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => new Date().toISOString() },
  portalFirestore: vi.fn(),
}));

vi.mock('@/features/events/shared/google-sheets-sender', () => ({
  sendToGoogleSheet: vi.fn(),
}));

const mockCheckExistingRegistration = vi.fn().mockResolvedValue(null);
vi.mock('@/features/events/shared/duplicate-check', () => ({
  checkExistingRegistration: (...args: Parameters<typeof mockCheckExistingRegistration>) =>
    mockCheckExistingRegistration(...args),
}));

const mockCheckSevakByEmail = vi.fn().mockResolvedValue(true);
vi.mock('@/features/events/shared/sevak-check', () => ({
  checkSevakByEmail: (...args: Parameters<typeof mockCheckSevakByEmail>) =>
    mockCheckSevakByEmail(...args),
}));

const mockFindFamilyById = vi.fn().mockResolvedValue({ fid: '383', contacts: [] });
const mockFindFamilyByContact = vi.fn().mockResolvedValue({ fid: '383', contacts: [] });
vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: (...args: Parameters<typeof mockFindFamilyById>) =>
    mockFindFamilyById(...args),
  findFamilyByContact: (...args: Parameters<typeof mockFindFamilyByContact>) =>
    mockFindFamilyByContact(...args),
}));

const mockAfterCallbacks: (() => Promise<void>)[] = [];
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (cb: () => Promise<void>) => { mockAfterCallbacks.push(cb); },
  };
});

import * as appHandler from '../route';

const validPayload = {
  registrationId: 'MD26-ABC1234',
  name: 'John Doe',
  email: 'john@example.com',
  phone: '416-555-0000',
  adults: 2,
  children: 1,
  payment_source: 'etransfer' as const,
  contribution: 15,
};

describe('POST /api/events/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
    mockCheckExistingRegistration.mockResolvedValue(null);
    mockCheckSevakByEmail.mockResolvedValue(true);
    mockFindFamilyById.mockResolvedValue({ fid: '383', contacts: [] });
    mockFindFamilyByContact.mockResolvedValue({ fid: '383', contacts: [] });
    mockAfterCallbacks.length = 0;
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = 'https://script.google.com/test';
  });

  it('returns success for valid payload', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.registrationId).toBe('MD26-ABC1234');
      },
    });
  });

  it('writes to Firebase with create()', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'john@example.com',
            paymentStatus: 'pending',
          }),
        );
      },
    });
  });

  it('returns 409 if registration ID already exists', async () => {
    mockCreate.mockRejectedValue(new Error('6 ALREADY_EXISTS: Document already exists'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(409);
      },
    });
  });

  it('returns 400 for invalid registrationId format', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, registrationId: 'abc' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for missing required fields', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for adults below minimum', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, adults: 0 }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('accepts optional etransferReference field', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, etransferReference: 'C1AsjcyW6gqU' }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('rejects etransferReference longer than 50 characters', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, etransferReference: 'A'.repeat(51) }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('accepts optional category, additionalAttendees, mothersInPuja fields', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...validPayload,
            category: 'bv-family',
            additionalAttendees: 2,
            mothersInPuja: 1,
          }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('accepts optional fid field and writes to Firebase', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, fid: '1257' }),
        });
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({ fid: '1257' }),
        );
      },
    });
  });

  it('writes category, additionalAttendees, mothersInPuja to Firebase', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...validPayload,
            category: 'sevak',
            additionalAttendees: 1,
            mothersInPuja: 0,
          }),
        });
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            category: 'sevak',
            additionalAttendees: 1,
            mothersInPuja: 0,
          }),
        );
      },
    });
  });

  it('returns 409 with existingRegistration when BV family fid matches', async () => {
    const existing = { registrationId: 'MD26-EXISTING', paymentStatus: 'completed' };
    mockCheckExistingRegistration.mockResolvedValueOnce(existing);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'bv-family', fid: '383' }),
        });
        const data = await res.json();
        expect(res.status).toBe(409);
        expect(data.error).toBe('Duplicate registration');
        expect(data.existingRegistration).toEqual(existing);
        expect(mockCreate).not.toHaveBeenCalled();
      },
    });
  });

  it('returns 409 when BV family fid is null and bvFamilyEmail matches', async () => {
    const existing = { registrationId: 'MD26-DUPE01', paymentStatus: 'pending' };
    mockCheckExistingRegistration.mockResolvedValueOnce(existing);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'bv-family' }),
        });
        const data = await res.json();
        expect(res.status).toBe(409);
        expect(data.existingRegistration).toEqual(existing);
        expect(mockCreate).not.toHaveBeenCalled();
      },
    });
  });

  it('returns 409 when sevak email matches', async () => {
    const existing = { registrationId: 'MD26-SEVAK1', paymentStatus: 'pending' };
    mockCheckExistingRegistration.mockResolvedValueOnce(existing);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'sevak' }),
        });
        const data = await res.json();
        expect(res.status).toBe(409);
        expect(data.existingRegistration).toEqual(existing);
        expect(mockCreate).not.toHaveBeenCalled();
      },
    });
  });

  it('returns 409 when non-BV email matches', async () => {
    const existing = { registrationId: 'MD26-NONBV1', paymentStatus: 'pending' };
    mockCheckExistingRegistration.mockResolvedValueOnce(existing);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'non-bv' }),
        });
        const data = await res.json();
        expect(res.status).toBe(409);
        expect(data.existingRegistration).toEqual(existing);
        expect(mockCreate).not.toHaveBeenCalled();
      },
    });
  });

  it('proceeds with registration when duplicate check throws', async () => {
    mockCheckExistingRegistration.mockRejectedValueOnce(new Error('Firestore timeout'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'non-bv' }),
        });
        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalled();
      },
    });
  });

  it('lowercases email before duplicate check and storage', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, email: 'JOHN@EXAMPLE.COM', category: 'non-bv' }),
        });
        expect(mockCheckExistingRegistration).toHaveBeenCalledWith(
          expect.objectContaining({ value: 'john@example.com' }),
        );
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({ email: 'john@example.com' }),
        );
      },
    });
  });

  // --- Mothers cap tests ---

  it('returns 400 for BV Family with 2 adults and 2 mothers (cap violation)', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...validPayload,
            category: 'bv-family',
            adults: 2,
            mothersInPuja: 2,
          }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Maximum 1 mother for BV Family or Sevak with 2 adults');
        expect(mockCreate).not.toHaveBeenCalled();
      },
    });
  });

  it('returns 400 for Sevak with 2 adults and 2 mothers (MD26-09YV920 scenario)', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...validPayload,
            category: 'sevak',
            adults: 2,
            mothersInPuja: 2,
          }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Maximum 1 mother for BV Family or Sevak with 2 adults');
        expect(mockCreate).not.toHaveBeenCalled();
      },
    });
  });

  it('returns 200 for non-BV with 2 adults and 2 mothers (no cap)', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...validPayload,
            category: 'non-bv',
            adults: 2,
            mothersInPuja: 2,
          }),
        });
        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalled();
      },
    });
  });

  it('returns 200 for BV Family with 1 adult and 1 mother (under cap)', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...validPayload,
            category: 'bv-family',
            adults: 1,
            mothersInPuja: 1,
          }),
        });
        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalled();
      },
    });
  });

  // --- Roster re-verification tests ---

  it('returns 403 when sevak email is not in roster', async () => {
    mockCheckSevakByEmail.mockResolvedValueOnce(false);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'sevak' }),
        });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toBe('Email not found in BV Teacher/Sevak roster');
        expect(mockCreate).not.toHaveBeenCalled();
      },
    });
  });

  it('returns 403 when BV Family fid is not found in roster', async () => {
    mockFindFamilyById.mockResolvedValueOnce(null);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'bv-family', fid: '9999' }),
        });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toBe('Not found in BV Family roster');
        expect(mockCreate).not.toHaveBeenCalled();
      },
    });
  });

  it('returns 200 for valid sevak in roster', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'sevak' }),
        });
        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalled();
      },
    });
  });

  it('returns 200 for valid BV Family in roster', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'bv-family', fid: '383' }),
        });
        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalled();
      },
    });
  });

  it('proceeds with 200 when sevak roster check throws (graceful degradation)', async () => {
    mockCheckSevakByEmail.mockRejectedValueOnce(new Error('Firebase timeout'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'sevak' }),
        });
        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalled();
      },
    });
  });

  it('skips sevak and BV roster checks for non-BV category', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, category: 'non-bv' }),
        });
        expect(mockCheckSevakByEmail).not.toHaveBeenCalled();
        expect(mockFindFamilyById).not.toHaveBeenCalled();
        expect(mockFindFamilyByContact).not.toHaveBeenCalled();
      },
    });
  });
});
