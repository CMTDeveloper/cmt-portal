import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/lib/flags', () => ({
  flags: { eventsRegister: true },
}));

vi.mock('@/features/events/shared/rate-limiter', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import * as appHandler from '../route';
import { checkIpRateLimit } from '@/features/events/shared/rate-limiter';

const ORIGIN = 'https://cmt-portal.vercel.app';

const validPayload = {
  lineItems: [
    { name: 'Adults' as const, amount: 10.0, quantity: 2 },
    { name: 'Processing Fees' as const, amount: 0.74, quantity: 1 },
  ],
  customerEmail: 'test@example.com',
  client_reference_id: 'MD26-ABC1234',
  successUrl: `${ORIGIN}/events/register/success?regId=MD26-ABC1234`,
  cancelUrl: `${ORIGIN}/events/register/cancel?regId=MD26-ABC1234`,
  metadata: { campaign: '2026MothersDay' },
  branding_settings: { display_name: 'CMT Mothers Day' },
};

function mockStripeSuccess() {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          checkoutUrl: 'https://checkout.stripe.com/test',
          sessionId: 'cs_test_123',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
}

describe('POST /api/events/create-checkout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(checkIpRateLimit).mockResolvedValue({ allowed: true });
    vi.stubGlobal('fetch', mockStripeSuccess());
    process.env.STRIPE_CHECKOUT_URL = 'https://stripe-api.example.com/checkout';
    process.env.STRIPE_API_KEY = 'test_key';
  });

  it('returns checkoutUrl for valid payload', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify(validPayload),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.checkoutUrl).toBe('https://checkout.stripe.com/test');
        expect(data.sessionId).toBe('cs_test_123');
      },
    });
  });

  it('forwards payload to Stripe with API key header', async () => {
    const globalFetchMock = mockStripeSuccess();
    vi.stubGlobal('fetch', globalFetchMock);

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify(validPayload),
        });
        expect(globalFetchMock).toHaveBeenCalledWith(
          'https://stripe-api.example.com/checkout',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'x-api-key': 'test_key',
            }),
          }),
        );
      },
    });
  });

  it('returns 400 for missing lineItems', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ ...validPayload, lineItems: [] }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for invalid client_reference_id format', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ ...validPayload, client_reference_id: 'BADID' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for invalid email', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ ...validPayload, customerEmail: 'not-email' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for invalid line item name', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({
            ...validPayload,
            lineItems: [{ name: 'Hacked', amount: 0.01, quantity: 1 }],
          }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('accepts BV Teacher/Sevak + Additional Attendees line items', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({
            ...validPayload,
            lineItems: [
              { name: 'BV Teacher/Sevak' as const, amount: 10.0, quantity: 1 },
              { name: 'Additional Attendees' as const, amount: 10.0, quantity: 2 },
              { name: 'Processing Fees' as const, amount: 0.96, quantity: 1 },
            ],
          }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('accepts BV Family + Additional Attendees line items', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({
            ...validPayload,
            lineItems: [
              { name: 'BV Family' as const, amount: 10.0, quantity: 1 },
              { name: 'Additional Attendees' as const, amount: 10.0, quantity: 1 },
              { name: 'Processing Fees' as const, amount: 0.74, quantity: 1 },
            ],
          }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('rejects Additional Attendees with manipulated price', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({
            ...validPayload,
            lineItems: [
              { name: 'BV Family' as const, amount: 10.0, quantity: 1 },
              { name: 'Additional Attendees' as const, amount: 0.01, quantity: 3 },
              { name: 'Processing Fees' as const, amount: 0.37, quantity: 1 },
            ],
          }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for manipulated per-person price', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({
            ...validPayload,
            lineItems: [
              { name: 'Adults', amount: 0.01, quantity: 2 },
              { name: 'Processing Fees', amount: 0.30, quantity: 1 },
            ],
          }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for incorrect processing fee', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({
            ...validPayload,
            lineItems: [
              { name: 'Adults', amount: 10.0, quantity: 2 },
              { name: 'Processing Fees', amount: 0.01, quantity: 1 },
            ],
          }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('accepts redirect URLs matching origin header', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('accepts redirect URLs with portal vercel.app domain', async () => {
    const vercelOrigin = 'https://cmt-portal-abc123.vercel.app';
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: vercelOrigin },
          body: JSON.stringify({
            ...validPayload,
            successUrl: `${vercelOrigin}/events/register/success?regId=MD26-ABC1234`,
            cancelUrl: `${vercelOrigin}/events/register/cancel?regId=MD26-ABC1234`,
          }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('rejects redirect URLs to external domains', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({
            ...validPayload,
            successUrl: 'https://evil.com/phishing?regId=MD26-ABC1234',
            cancelUrl: `${ORIGIN}/events/register/cancel?regId=MD26-ABC1234`,
          }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Invalid redirect URLs');
      },
    });
  });

  it('returns 502 when Stripe returns error (no details leaked)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Internal Stripe Error: secret-info', { status: 500 }),
    ));

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify(validPayload),
        });
        const data = await res.json();
        expect(res.status).toBe(502);
        expect(data.error).toBe('Failed to create checkout session');
        expect(JSON.stringify(data)).not.toContain('secret-info');
      },
    });
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(checkIpRateLimit).mockResolvedValue({ allowed: false });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: ORIGIN },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(429);
        const data = await res.json();
        expect(data.error).toContain('Too many requests');
      },
    });
  });
});
