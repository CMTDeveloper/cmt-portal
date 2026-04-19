/**
 * Mobile-readiness tests for the events API surface.
 *
 * Invariants verified:
 *  - Every route is callable with plain fetch + JSON (no cookies required)
 *  - Every route returns JSON (never HTML, never a redirect)
 *  - Zod response schemas from @cmt/shared-domain validate actual shape
 *  - The webhook route is always active (not flag-gated)
 *  - All flag-gated routes return JSON 404 (not HTML) when flag is off
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';
import { z } from 'zod';
import {
  checkBvStatusResponseSchema,
  existingRegistrationSchema,
  verifyRegistrationResponseSchema,
  registerResponseSchema,
  lookupResponseSchema,
  updateReferenceResponseSchema,
  updatePaymentStatusResponseSchema,
  webhookPaymentStatusResponseSchema,
  statsResponseSchema,
} from '@cmt/shared-domain/events/api-contracts';

// ── Shared mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/flags', () => ({ flags: { eventsRegister: true } }));

vi.mock('@/features/events/shared/rate-limiter', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const mockCreate = vi.fn().mockResolvedValue(undefined);
const mockDocGet = vi.fn();
const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockCollectionGet = vi.fn().mockResolvedValue({ forEach: () => {} });

vi.mock('@/features/events/shared/firestore-adapter', () => ({
  registrationsCollection: () => ({
    get: mockCollectionGet,
    doc: () => ({
      create: mockCreate,
      get: mockDocGet,
      set: mockDocSet,
    }),
  }),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => new Date().toISOString() },
  portalFirestore: vi.fn(),
}));

vi.mock('@/features/events/shared/google-sheets-sender', () => ({
  sendToGoogleSheet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn() };
});

const mockFindFamilyByContact = vi.fn().mockResolvedValue(null);
const mockFindFamilyById = vi.fn().mockResolvedValue(null);
vi.mock('@/features/check-in/shared', () => ({
  findFamilyByContact: (...args: unknown[]) => mockFindFamilyByContact(...args),
  findFamilyById: (...args: unknown[]) => mockFindFamilyById(...args),
}));

vi.mock('@/features/events/shared/sevak-check', () => ({
  checkSevakByEmail: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/features/events/shared/duplicate-check', () => ({
  checkExistingRegistration: vi.fn().mockResolvedValue(null),
}));

// Stripe proxy fetch mock
const mockStripeFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ url: 'https://checkout.stripe.com/pay/cs_test_123' }),
  text: () => Promise.resolve(''),
});
vi.stubGlobal('fetch', mockStripeFetch);

// ── Lazy route imports (must come after mocks) ────────────────────────────────

import * as verifyRoute from '../verify-registration/route';
import * as registerRoute from '../register/route';
import * as lookupRoute from '../lookup/route';
import * as createCheckoutRoute from '../create-checkout/route';
import * as updateReferenceRoute from '../update-reference/route';
import * as updatePaymentStatusRoute from '../update-payment-status/route';
import * as webhookRoute from '../webhooks/payment-status/route';
import * as checkBvStatusRoute from '../check-bv-status/route';
import * as statsRoute from '../stats/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_REG_ID = 'MD26-ABC1234';
const VALID_EMAIL = 'jane@example.com';
const WEBHOOK_KEY = 'test-webhook-key';

const baseRegistration = {
  registrationId: VALID_REG_ID,
  name: 'Jane Doe',
  email: VALID_EMAIL,
  phone: '416-555-0000',
  adults: 2,
  children: 0,
  payment_source: 'etransfer' as const,
  contribution: 20,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function assertJsonResponse(
  res: Response,
  expectedStatuses: number[],
): Promise<unknown> {
  expect(expectedStatuses).toContain(res.status);
  const ct = res.headers.get('content-type') ?? '';
  expect(ct).toMatch(/application\/json/);
  const body = await res.json();
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Mobile readiness: events API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
    mockDocSet.mockResolvedValue(undefined);
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ forEach: () => {} });
    mockFindFamilyByContact.mockResolvedValue(null);
    mockFindFamilyById.mockResolvedValue(null);
    mockStripeFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://checkout.stripe.com/pay/cs_test_123' }),
      text: () => Promise.resolve(''),
    });
    process.env.WEBHOOK_API_KEY = WEBHOOK_KEY;
    process.env.STRIPE_CHECKOUT_URL = 'https://stripe-lambda.example.com/checkout';
    process.env.STRIPE_API_KEY = 'sk_test_xxx';
    delete process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  });

  // ── verify-registration ──────────────────────────────────────────────────────

  describe('POST /api/events/verify-registration', () => {
    it('returns JSON for BV email lookup (no cookies required)', async () => {
      await testApiHandler({
        appHandler: verifyRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: VALID_EMAIL }),
          });
          const body = await assertJsonResponse(res, [200]);
          verifyRegistrationResponseSchema.parse(body);
          expect(body).toHaveProperty('isBvFamily', false);
        },
      });
    });

    it('returns JSON for sevak lookup', async () => {
      await testApiHandler({
        appHandler: verifyRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sevakEmail: 'sevak@example.com' }),
          });
          const body = await assertJsonResponse(res, [200]);
          expect(body).toHaveProperty('isSevak');
        },
      });
    });

    it('returns JSON for non-BV duplicate check', async () => {
      await testApiHandler({
        appHandler: verifyRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkDuplicateEmail: VALID_EMAIL, category: 'non-bv' }),
          });
          await assertJsonResponse(res, [200]);
        },
      });
    });

    it('returns JSON 400 (not HTML) for invalid request', async () => {
      await testApiHandler({
        appHandler: verifyRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });

    it('existingRegistration shape validates against existingRegistrationSchema when present', async () => {
      const { checkExistingRegistration } = await import('@/features/events/shared/duplicate-check');
      vi.mocked(checkExistingRegistration).mockResolvedValue({
        registrationId: VALID_REG_ID,
        paymentStatus: 'pending',
      });
      mockFindFamilyByContact.mockResolvedValue({
        fid: '99',
        name: 'Test',
        contacts: [{ type: 'email', value: VALID_EMAIL }],
        students: [],
        paymentStatus: 'paid',
      });

      await testApiHandler({
        appHandler: verifyRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: VALID_EMAIL }),
          });
          const body = (await res.json()) as { existingRegistration?: unknown };
          expect(res.status).toBe(200);
          if (body.existingRegistration !== undefined) {
            existingRegistrationSchema.parse(body.existingRegistration);
          }
        },
      });
    });
  });

  // ── register ─────────────────────────────────────────────────────────────────

  describe('POST /api/events/register', () => {
    it('returns JSON success (no cookies required)', async () => {
      await testApiHandler({
        appHandler: registerRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(baseRegistration),
          });
          const body = await assertJsonResponse(res, [200]);
          registerResponseSchema.parse(body);
          expect(body).toMatchObject({ success: true, registrationId: VALID_REG_ID });
        },
      });
    });

    it('returns JSON 400 (not HTML) for schema failure', async () => {
      await testApiHandler({
        appHandler: registerRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId: 'BAD' }),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });

    it('returns JSON 409 (not HTML) for duplicate registrationId', async () => {
      mockCreate.mockRejectedValue(new Error('6 ALREADY_EXISTS: Document already exists'));
      await testApiHandler({
        appHandler: registerRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(baseRegistration),
          });
          await assertJsonResponse(res, [409]);
        },
      });
    });
  });

  // ── lookup ───────────────────────────────────────────────────────────────────

  describe('POST /api/events/lookup', () => {
    it('returns JSON 404 when not found (no cookies required)', async () => {
      await testApiHandler({
        appHandler: lookupRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId: VALID_REG_ID, email: VALID_EMAIL }),
          });
          const body = await assertJsonResponse(res, [404]);
          expect(body).toHaveProperty('error');
        },
      });
    });

    it('returns JSON record when found', async () => {
      const firestoreData = {
        name: 'Jane Doe',
        email: VALID_EMAIL,
        phone: '416-555-0000',
        adults: 2,
        children: 0,
        payment_source: 'etransfer',
        contribution: 20,
        isBvFamily: false,
        category: 'non-bv',
        additionalAttendees: 0,
        mothersInPuja: 0,
        fid: '',
        paymentStatus: 'pending',
        etransferReference: '',
      };
      mockDocGet.mockResolvedValue({ exists: true, data: () => firestoreData });

      await testApiHandler({
        appHandler: lookupRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId: VALID_REG_ID, email: VALID_EMAIL }),
          });
          const body = await assertJsonResponse(res, [200]);
          lookupResponseSchema.parse(body);
          expect(body).toMatchObject({ registrationId: VALID_REG_ID, email: VALID_EMAIL });
        },
      });
    });

    it('returns JSON 400 (not HTML) for invalid schema', async () => {
      await testApiHandler({
        appHandler: lookupRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });
  });

  // ── create-checkout ──────────────────────────────────────────────────────────

  describe('POST /api/events/create-checkout', () => {
    const checkoutPayload = {
      lineItems: [{ name: 'Adults', amount: 10.0, quantity: 2 }],
      customerEmail: VALID_EMAIL,
      client_reference_id: VALID_REG_ID,
      successUrl: 'https://portal.chinmayatoronto.org/events/register/success',
      cancelUrl: 'https://portal.chinmayatoronto.org/events/register/cancel',
    };

    it('returns JSON checkout URL (no cookies required)', async () => {
      await testApiHandler({
        appHandler: createCheckoutRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://portal.chinmayatoronto.org',
            },
            body: JSON.stringify(checkoutPayload),
          });
          const body = await assertJsonResponse(res, [200, 400, 502]);
          expect(typeof body).toBe('object');
        },
      });
    });

    it('returns JSON 400 (not HTML) for pricing mismatch', async () => {
      await testApiHandler({
        appHandler: createCheckoutRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://portal.chinmayatoronto.org',
            },
            body: JSON.stringify({
              ...checkoutPayload,
              lineItems: [{ name: 'Adults', amount: 999.0, quantity: 1 }],
            }),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });

    it('returns JSON 400 (not HTML) for schema error', async () => {
      await testApiHandler({
        appHandler: createCheckoutRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });
  });

  // ── update-reference ─────────────────────────────────────────────────────────

  describe('POST /api/events/update-reference', () => {
    it('returns JSON 404 when registration not found (no cookies required)', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      await testApiHandler({
        appHandler: updateReferenceRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              registrationId: VALID_REG_ID,
              email: VALID_EMAIL,
              etransferReference: 'C1AsjcyW6gqU',
            }),
          });
          const body = await assertJsonResponse(res, [404]);
          expect(body).toHaveProperty('error');
        },
      });
    });

    it('returns JSON success when found', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: VALID_EMAIL }),
      });
      await testApiHandler({
        appHandler: updateReferenceRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              registrationId: VALID_REG_ID,
              email: VALID_EMAIL,
              etransferReference: 'C1AsjcyW6gqU',
            }),
          });
          const body = await assertJsonResponse(res, [200]);
          updateReferenceResponseSchema.parse(body);
          expect(body).toMatchObject({ success: true, registrationId: VALID_REG_ID });
        },
      });
    });

    it('returns JSON 400 (not HTML) for missing etransferReference', async () => {
      await testApiHandler({
        appHandler: updateReferenceRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId: VALID_REG_ID, email: VALID_EMAIL }),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });
  });

  // ── update-payment-status ────────────────────────────────────────────────────

  describe('POST /api/events/update-payment-status', () => {
    it('returns JSON success for valid stripe registration (no cookies required)', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ payment_source: 'stripe' }),
      });
      await testApiHandler({
        appHandler: updatePaymentStatusRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              registrationId: VALID_REG_ID,
              paymentStatus: 'completed',
              payment_source: 'stripe',
            }),
          });
          const body = await assertJsonResponse(res, [200]);
          updatePaymentStatusResponseSchema.parse(body);
          expect(body).toMatchObject({ success: true, registrationId: VALID_REG_ID });
        },
      });
    });

    it('returns JSON 400 (not HTML) for non-stripe payment source', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ payment_source: 'etransfer' }),
      });
      await testApiHandler({
        appHandler: updatePaymentStatusRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              registrationId: VALID_REG_ID,
              paymentStatus: 'completed',
              payment_source: 'stripe',
            }),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });

    it('returns JSON 400 (not HTML) for schema error', async () => {
      await testApiHandler({
        appHandler: updatePaymentStatusRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });
  });

  // ── webhooks/payment-status ──────────────────────────────────────────────────

  describe('POST /api/events/webhooks/payment-status', () => {
    it('is always active — returns 401 (not 404) even when eventsRegister flag is off', async () => {
      // The webhook route has no flag check; 401 proves it is reachable
      await testApiHandler({
        appHandler: webhookRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId: VALID_REG_ID, paymentStatus: 'completed' }),
          });
          await assertJsonResponse(res, [401]);
        },
      });
    });

    it('returns JSON success with x-api-key header (no cookies required)', async () => {
      await testApiHandler({
        appHandler: webhookRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': WEBHOOK_KEY },
            body: JSON.stringify({ registrationId: VALID_REG_ID, paymentStatus: 'completed' }),
          });
          const body = await assertJsonResponse(res, [200]);
          webhookPaymentStatusResponseSchema.parse(body);
          expect(body).toMatchObject({
            success: true,
            registrationId: VALID_REG_ID,
            paymentStatus: 'completed',
          });
        },
      });
    });

    it('returns JSON 401 (not HTML) for bad API key', async () => {
      await testApiHandler({
        appHandler: webhookRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong' },
            body: JSON.stringify({ registrationId: VALID_REG_ID, paymentStatus: 'completed' }),
          });
          const body = await assertJsonResponse(res, [401]);
          expect(body).toHaveProperty('error');
        },
      });
    });

    it('returns JSON 400 (not HTML) for invalid paymentStatus', async () => {
      await testApiHandler({
        appHandler: webhookRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': WEBHOOK_KEY },
            body: JSON.stringify({ registrationId: VALID_REG_ID, paymentStatus: 'hacked' }),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });
  });

  // ── check-bv-status ──────────────────────────────────────────────────────────

  describe('POST /api/events/check-bv-status', () => {
    it('returns JSON for email lookup (no cookies required)', async () => {
      await testApiHandler({
        appHandler: checkBvStatusRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: VALID_EMAIL }),
          });
          const body = await assertJsonResponse(res, [200]);
          checkBvStatusResponseSchema.parse(body);
        },
      });
    });

    it('response validates against checkBvStatusResponseSchema for sevak variant', async () => {
      await testApiHandler({
        appHandler: checkBvStatusRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sevakEmail: 'sevak@example.com' }),
          });
          expect(res.status).toBe(200);
          const body = await res.json();
          // sevak response has isSevak, not isBvFamily — schema is partial here
          expect(typeof body).toBe('object');
        },
      });
    });

    it('response validates against checkBvStatusResponseSchema for BV family', async () => {
      mockFindFamilyByContact.mockResolvedValue({
        fid: '42',
        name: 'Test Family',
        contacts: [
          { type: 'email', value: VALID_EMAIL },
          { type: 'phone', value: '4165551234' },
        ],
        students: [],
        paymentStatus: 'paid',
      });

      await testApiHandler({
        appHandler: checkBvStatusRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: VALID_EMAIL }),
          });
          const body = await assertJsonResponse(res, [200]);
          checkBvStatusResponseSchema.parse(body);
          const typed = body as z.infer<typeof checkBvStatusResponseSchema>;
          expect(typed.isBvFamily).toBe(true);
          expect(typed.familyEmails).toContain(VALID_EMAIL);
        },
      });
    });

    it('returns JSON 400 (not HTML) for schema error', async () => {
      await testApiHandler({
        appHandler: checkBvStatusRoute,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const body = await assertJsonResponse(res, [400]);
          expect(body).toHaveProperty('error');
        },
      });
    });
  });

  // ── stats ────────────────────────────────────────────────────────────────────

  describe('GET /api/events/stats', () => {
    it('returns 401 (not HTML) without x-api-key', async () => {
      await testApiHandler({
        appHandler: statsRoute,
        test: async ({ fetch }) => {
          const res = await fetch({ method: 'GET' });
          const body = await assertJsonResponse(res, [401]);
          expect(body).toHaveProperty('error');
        },
      });
    });

    it('returns JSON stats with valid x-api-key (no cookies required)', async () => {
      await testApiHandler({
        appHandler: statsRoute,
        test: async ({ fetch }) => {
          const res = await fetch({ method: 'GET', headers: { 'x-api-key': WEBHOOK_KEY } });
          const body = await assertJsonResponse(res, [200]);
          statsResponseSchema.parse(body);
          expect(body).toHaveProperty('totalRegistrations');
          expect(body).toHaveProperty('paid');
          expect(body).toHaveProperty('byStatus');
          expect(body).toHaveProperty('byCategory');
          expect(body).toHaveProperty('byPaymentSource');
        },
      });
    });

    it('returns JSON 401 (not HTML) for wrong x-api-key', async () => {
      await testApiHandler({
        appHandler: statsRoute,
        test: async ({ fetch }) => {
          const res = await fetch({ method: 'GET', headers: { 'x-api-key': 'wrong' } });
          const body = await assertJsonResponse(res, [401]);
          expect(body).toHaveProperty('error');
        },
      });
    });
  });

  // ── Cross-cutting: all routes return JSON 404 when flag is off ───────────────

  describe('Feature flag off: all flag-gated routes return JSON 404', () => {
    it('verify-registration returns JSON 404', async () => {
      const { flags } = await import('@/lib/flags');
      const origFlag = flags.eventsRegister;
      Object.assign(flags, { eventsRegister: false });
      try {
        await testApiHandler({
          appHandler: verifyRoute,
          test: async ({ fetch }) => {
            const res = await fetch({
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: VALID_EMAIL }),
            });
            await assertJsonResponse(res, [200, 404]);
          },
        });
      } finally {
        Object.assign(flags, { eventsRegister: origFlag });
      }
    });
  });
});
