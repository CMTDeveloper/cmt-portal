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
  paymentStatus: 'completed' as const,
  payment_source: 'stripe' as const,
};

describe('POST /api/events/update-payment-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ payment_source: 'stripe', paymentStatus: 'pending' }),
    });
    mockSet.mockResolvedValue(undefined);
    mockSendToGoogleSheet.mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = 'https://script.google.com/test';
  });

  it('returns success for valid Stripe payment completion', async () => {
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

  it('updates Firebase with completed status', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(mockSet).toHaveBeenCalledWith(
          expect.objectContaining({
            paymentStatus: 'completed',
            payment_source: 'stripe',
          }),
          { merge: true },
        );
      },
    });
  });

  it('forwards status update to Google Sheet', async () => {
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
          expect.objectContaining({ paymentStatus: 'completed' }),
        );
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

  it('returns 400 for non-completed paymentStatus', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, paymentStatus: 'pending' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for non-stripe payment_source', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, payment_source: 'etransfer' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for missing fields', async () => {
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

  it('returns 400 when registration is not a Stripe payment', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ payment_source: 'etransfer', paymentStatus: 'pending' }),
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('still updates Firebase even if verification lookup fails', async () => {
    mockGet.mockRejectedValue(new Error('Firebase read timeout'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(200);
        expect(mockSet).toHaveBeenCalled();
      },
    });
  });

  it('succeeds even if Google Sheet URL not configured', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(200);
      },
    });
  });
});
