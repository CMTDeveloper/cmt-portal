import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/events/shared/firestore-adapter', () => ({
  registrationsCollection: () => ({
    doc: () => ({
      set: vi.fn().mockResolvedValue(undefined),
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

const VALID_API_KEY = 'test-webhook-key-123';

describe('POST /api/events/webhooks/payment-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendToGoogleSheet.mockResolvedValue(undefined);
    process.env.WEBHOOK_API_KEY = VALID_API_KEY;
    delete process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  });

  it('returns 401 when x-api-key header is missing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: 'completed' }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 401 when x-api-key is invalid', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-key' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: 'completed' }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 401 when WEBHOOK_API_KEY env var is not set', async () => {
    delete process.env.WEBHOOK_API_KEY;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: 'completed' }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns success for valid payload with correct API key', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: 'completed' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.registrationId).toBe('MD26-ABC1234');
        expect(data.paymentStatus).toBe('completed');
      },
    });
  });

  it('returns 400 when registrationId is missing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ paymentStatus: 'completed' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 when paymentStatus is missing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234' }),
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
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'BADID', paymentStatus: 'completed' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for invalid paymentStatus value', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: 'hacked' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 when body is empty', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('forwards payment status to Google Sheet', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = 'https://script.google.com/test';
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'MD26-XYZ9999', paymentStatus: 'completed', payment_source: 'stripe' }),
        });
        expect(mockSendToGoogleSheet).toHaveBeenCalledWith(
          'https://script.google.com/test',
          expect.objectContaining({ registrationId: 'MD26-XYZ9999' }),
        );
      },
    });
  });

  it('defaults payment_source to unknown', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = 'https://script.google.com/test';
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: 'completed' }),
        });
        expect(mockSendToGoogleSheet).toHaveBeenCalledWith(
          'https://script.google.com/test',
          expect.objectContaining({ payment_source: 'unknown' }),
        );
      },
    });
  });

  it('succeeds even if Google Sheet call fails', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = 'https://script.google.com/test';
    mockSendToGoogleSheet.mockRejectedValue(new Error('Network error'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: 'completed' }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('skips Google Sheet when URL not configured', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: 'pending' }),
        });
        expect(res.status).toBe(200);
        expect(mockSendToGoogleSheet).not.toHaveBeenCalled();
      },
    });
  });

  it('accepts all valid paymentStatus values', async () => {
    for (const status of ['completed', 'pending', 'failed', 'refunded']) {
      await testApiHandler({
        appHandler,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': VALID_API_KEY },
            body: JSON.stringify({ registrationId: 'MD26-ABC1234', paymentStatus: status }),
          });
          const data = await res.json();
          expect(res.status).toBe(200);
          expect(data.paymentStatus).toBe(status);
        },
      });
    }
  });
});
