import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/lib/flags', () => ({
  flags: { eventsRegister: true },
}));

const mockGet = vi.fn();
const mockSet = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/events/shared/firestore-adapter', () => ({
  registrationsCollection: () => ({
    doc: () => ({
      get: mockGet,
      set: mockSet,
    }),
  }),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => new Date().toISOString() },
  portalFirestore: vi.fn(),
}));

const mockSendToGoogleSheet = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/events/shared/google-sheets-sender', () => ({
  sendToGoogleSheet: (...args: unknown[]) => mockSendToGoogleSheet(...args),
}));

import * as appHandler from '../route';

const validPayload = {
  registrationId: 'MD26-ABC1234',
  email: 'john@example.com',
  etransferReference: 'C1AsjcyW6gqU',
};

describe('POST /api/events/update-reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: 'john@example.com' }),
    });
    mockSet.mockResolvedValue(undefined);
    mockSendToGoogleSheet.mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = 'https://script.google.com/test';
  });

  it('returns success for valid payload with matching email', async () => {
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
      },
    });
  });

  it('email matching is case-insensitive', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, email: 'JOHN@EXAMPLE.COM' }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('updates Firebase with set merge', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(mockSet).toHaveBeenCalledWith(
          expect.objectContaining({ etransferReference: 'C1AsjcyW6gqU' }),
          { merge: true },
        );
      },
    });
  });

  it('forwards reference to Google Sheet', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(mockSendToGoogleSheet).toHaveBeenCalledWith(
          'https://script.google.com/test',
          expect.objectContaining({ etransferReference: 'C1AsjcyW6gqU' }),
        );
      },
    });
  });

  it('returns 404 when email does not match registration', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, email: 'wrong@example.com' }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it('returns 404 when registration does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it('returns 502 when Firebase is down during verification', async () => {
    mockGet.mockRejectedValue(new Error('Firebase unavailable'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(502);
      },
    });
  });

  it('returns 400 for missing email', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', etransferReference: 'C1AsjcyW6gqU' }),
        });
        expect(res.status).toBe(400);
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
          body: JSON.stringify({ ...validPayload, registrationId: 'BADID' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for missing etransferReference', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'john@example.com' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for etransferReference longer than 50 characters', async () => {
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

  it('returns 400 for empty body', async () => {
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
});
