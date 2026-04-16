import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/lib/flags', () => ({
  flags: { eventsRegister: true },
}));

const mockGet = vi.fn();
vi.mock('@/features/events/shared/firestore-adapter', () => ({
  registrationsCollection: () => ({
    doc: () => ({
      get: mockGet,
    }),
  }),
}));

import * as appHandler from '../route';

const mockRegistration = {
  registrationId: 'MD26-ABC1234',
  name: 'John Doe',
  email: 'john@example.com',
  phone: '416-555-0000',
  adults: 2,
  children: 1,
  payment_source: 'etransfer',
  contribution: 15,
  paymentStatus: 'pending',
  etransferReference: '',
};

describe('POST /api/events/lookup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = 'https://script.google.com/test';
    mockGet.mockResolvedValue({
      exists: true,
      data: () => mockRegistration,
    });
  });

  it('returns registration data from Firebase', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'john@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.registrationId).toBe('MD26-ABC1234');
        expect(data.name).toBe('John Doe');
        expect(data.paymentStatus).toBe('pending');
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
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'JOHN@EXAMPLE.COM' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.registrationId).toBe('MD26-ABC1234');
      },
    });
  });

  it('falls back to Google Sheet when Firebase doc not found', async () => {
    mockGet.mockResolvedValue({ exists: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockRegistration), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'john@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.registrationId).toBe('MD26-ABC1234');
      },
    });
  });

  it('falls back to Google Sheet when Firebase throws', async () => {
    mockGet.mockRejectedValue(new Error('Firebase unavailable'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockRegistration), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'john@example.com' }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('returns paymentStatus completed for paid Stripe registration', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ ...mockRegistration, payment_source: 'stripe', paymentStatus: 'completed' }),
    });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'john@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.paymentStatus).toBe('completed');
      },
    });
  });

  it('defaults paymentStatus to pending when field is missing in Firebase', async () => {
    const { paymentStatus: _, ...regWithoutStatus } = mockRegistration;
    mockGet.mockResolvedValue({
      exists: true,
      data: () => regWithoutStatus,
    });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'john@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.paymentStatus).toBe('pending');
      },
    });
  });

  it('returns 404 when both Firebase and Google Sheet have no data', async () => {
    mockGet.mockResolvedValue({ exists: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-NOTFOUND', email: 'x@x.com' }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it('returns 404 when Google Sheet returns HTML', async () => {
    mockGet.mockResolvedValue({ exists: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html>Error</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    ));

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'x@x.com' }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it('returns 404 when Google Sheet URL not configured and Firebase has no data', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    mockGet.mockResolvedValue({ exists: false });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'x@x.com' }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it('returns 400 for missing registrationId', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'john@example.com' }),
        });
        expect(res.status).toBe(400);
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
          body: JSON.stringify({ registrationId: 'MD26-ABC1234' }),
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
          body: JSON.stringify({ registrationId: 'MD26-ABC1234', email: 'not-email' }),
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
