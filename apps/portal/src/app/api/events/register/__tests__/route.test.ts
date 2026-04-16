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
});
