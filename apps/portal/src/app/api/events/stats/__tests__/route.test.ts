import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

type RegDoc = {
  mothersInPuja?: number;
  adults?: number;
  children?: number;
  additionalAttendees?: number;
  paymentStatus?: string;
  category?: string;
  isBvFamily?: boolean;
  contribution?: number;
  payment_source?: string;
};

let mockDocs: RegDoc[] = [];

vi.mock('@/features/events/shared/firestore-adapter', () => ({
  registrationsCollection: () => ({
    get: vi.fn().mockImplementation(() =>
      Promise.resolve({
        forEach: (cb: (doc: { data: () => RegDoc }) => void) => {
          mockDocs.forEach((d) => cb({ data: () => d }));
        },
      }),
    ),
  }),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

import * as appHandler from '../route';

const VALID_API_KEY = 'test-stats-key-123';

describe('GET /api/events/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_API_KEY = VALID_API_KEY;
    mockDocs = [];
  });

  // ── Auth ──

  it('returns 401 when x-api-key header is missing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 401 for invalid x-api-key', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': 'wrong-key' } });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 401 when WEBHOOK_API_KEY env var is unset', async () => {
    delete process.env.WEBHOOK_API_KEY;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 200 with valid API key', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        expect(res.status).toBe(200);
      },
    });
  });

  // ── Aggregation basics ──

  it('returns zeros for empty registrations', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.totalRegistrations).toBe(0);
        expect(data.totalMothers).toBe(0);
        expect(data.totalAttendees).toBe(0);
      },
    });
  });

  it('counts totalRegistrations correctly', async () => {
    mockDocs = [{}, {}, {}];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.totalRegistrations).toBe(3);
      },
    });
  });

  it('sums mothersInPuja across all registrations', async () => {
    mockDocs = [
      { mothersInPuja: 2, paymentStatus: 'completed' },
      { mothersInPuja: 1, paymentStatus: 'completed' },
      { mothersInPuja: 3, paymentStatus: 'pending' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.totalMothers).toBe(6);
      },
    });
  });

  // ── paid.mothers (completed + review only) ──

  it('sums paid.mothers for completed and review only', async () => {
    mockDocs = [
      { mothersInPuja: 2, paymentStatus: 'completed' },
      { mothersInPuja: 3, paymentStatus: 'review' },
      { mothersInPuja: 5, paymentStatus: 'pending' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.totalMothers).toBe(10);
        expect(data.paid.mothers).toBe(5);
      },
    });
  });

  it('excludes failed/refunded/pending from paid.mothers', async () => {
    mockDocs = [
      { mothersInPuja: 1, paymentStatus: 'failed' },
      { mothersInPuja: 2, paymentStatus: 'refunded' },
      { mothersInPuja: 3, paymentStatus: 'pending' },
      { mothersInPuja: 4, paymentStatus: 'completed' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.paid.mothers).toBe(4);
      },
    });
  });

  // ── attendees ──

  it('counts attendees as adults + children + additionalAttendees', async () => {
    mockDocs = [
      { adults: 2, children: 3, additionalAttendees: 1, paymentStatus: 'completed' },
      { adults: 1, children: 0, additionalAttendees: 2, paymentStatus: 'pending' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.totalAttendees).toBe(9);
        expect(data.paid.attendees).toBe(6);
      },
    });
  });

  // ── byStatus ──

  it('groups registrations by paymentStatus', async () => {
    mockDocs = [
      { paymentStatus: 'completed' },
      { paymentStatus: 'completed' },
      { paymentStatus: 'pending' },
      { paymentStatus: 'review' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.byStatus.completed).toBe(2);
        expect(data.byStatus.pending).toBe(1);
        expect(data.byStatus.review).toBe(1);
      },
    });
  });

  // ── byCategory ──

  it('groups registrations by category', async () => {
    mockDocs = [
      { category: 'bv-family' },
      { category: 'bv-family' },
      { category: 'sevak' },
      { category: 'non-bv' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.byCategory['bv-family']).toBe(2);
        expect(data.byCategory.sevak).toBe(1);
        expect(data.byCategory['non-bv']).toBe(1);
      },
    });
  });

  it('classifies pre-V2 records without category as legacy', async () => {
    mockDocs = [
      { isBvFamily: true, paymentStatus: 'completed' },
      { category: 'bv-family', paymentStatus: 'completed' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.byCategory.legacy).toBe(1);
        expect(data.byCategory['bv-family']).toBe(1);
      },
    });
  });

  it('classifies records with no category and no isBvFamily as legacy', async () => {
    mockDocs = [{}];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.byCategory.legacy).toBe(1);
      },
    });
  });

  // ── byPaymentSource ──

  it('groups by payment_source', async () => {
    mockDocs = [
      { payment_source: 'stripe', paymentStatus: 'completed' },
      { payment_source: 'stripe', paymentStatus: 'pending' },
      { payment_source: 'etransfer', paymentStatus: 'completed' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.byPaymentSource.stripe).toBe(2);
        expect(data.byPaymentSource.etransfer).toBe(1);
      },
    });
  });

  it('defaults missing payment_source to unknown', async () => {
    mockDocs = [{ paymentStatus: 'completed' }];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.byPaymentSource.unknown).toBe(1);
      },
    });
  });

  // ── contribution ──

  it('sums totalContribution and rounds to 2 decimal places', async () => {
    mockDocs = [
      { contribution: 10, paymentStatus: 'completed' },
      { contribution: 20.5, paymentStatus: 'completed' },
      { contribution: 5, paymentStatus: 'pending' },
    ];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.totalContribution).toBe(35.5);
      },
    });
  });

  // ── response shape ──

  it('includes campaign and generatedAt in response', async () => {
    process.env.NEXT_PUBLIC_EVENT_CAMPAIGN = '2026MothersDay';
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.campaign).toBe('2026MothersDay');
        expect(data.generatedAt).toBeTruthy();
        expect(new Date(data.generatedAt).toString()).not.toBe('Invalid Date');
      },
    });
  });

  // ── missing/malformed fields ──

  it('handles completely empty registration documents gracefully', async () => {
    mockDocs = [{}, {}, {}];
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-api-key': VALID_API_KEY } });
        const data = await res.json();
        expect(data.totalRegistrations).toBe(3);
        expect(data.totalMothers).toBe(0);
        expect(data.totalAttendees).toBe(0);
        expect(data.totalContribution).toBe(0);
        expect(data.paid.mothers).toBe(0);
        expect(data.paid.attendees).toBe(0);
      },
    });
  });
});
