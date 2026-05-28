import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
// Mutable flag so we can flip it per test. vi.hoisted so it exists before the
// hoisted vi.mock factory runs.
const { flagState } = vi.hoisted(() => ({ flagState: { setuDonations: true } }));
vi.mock('@/lib/flags', () => ({ flags: flagState }));

const mockGetFamilyByFid = vi.fn();
const mockGetEnrollments = vi.fn();
const mockCreateDonation = vi.fn();

vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: (...a: unknown[]) => mockGetFamilyByFid(...a),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({
  getEnrollments: (...a: unknown[]) => mockGetEnrollments(...a),
}));
vi.mock('@/features/setu/donations/create-donation', () => ({
  createDonation: (...a: unknown[]) => mockCreateDonation(...a),
}));

import { POST } from '../route';

const DONOR = {
  mid: 'fid1-01',
  firstName: 'Raj',
  lastName: 'Patel',
  email: 'raj@example.com',
  type: 'Adult',
};

// Unique IP per request — the route's rate limiter is module-level and would
// otherwise accumulate across tests (all sharing ip='unknown') and 429 the 6th+.
let ipCounter = 0;

function makeReq(body: unknown, opts: { role?: string; fid?: string; mid?: string } = {}): Request {
  const { role = 'family-manager', fid = 'fid1', mid = 'fid1-01' } = opts;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: 'http://localhost:3000',
    'x-forwarded-for': `10.0.0.${++ipCounter}`,
    'x-portal-role': role,
  };
  if (fid) headers['x-portal-fid'] = fid;
  if (mid) headers['x-portal-mid'] = mid;
  return new Request('http://localhost:3000/api/setu/donations/checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function lastFetchInit(): { body: string; headers: Record<string, string> } {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const init = calls[0]?.[1];
  if (!init) throw new Error('fetch was not called');
  return init as { body: string; headers: Record<string, string> };
}

beforeEach(() => {
  vi.clearAllMocks();
  flagState.setuDonations = true;
  process.env.STRIPE_API_KEY = 'sk_test_x';
  process.env.STRIPE_CHECKOUT_URL = 'https://stripe-svc.example.com/checkout-link';
  process.env.STRIPE_USE_TEST_CHECKOUT = 'false';
  process.env.NEXT_PUBLIC_PORTAL_BASE_URL = 'http://localhost:3000';

  mockGetFamilyByFid.mockResolvedValue({
    family: { fid: 'fid1', name: 'Patel', location: 'Brampton' },
    members: [DONOR],
  });
  mockCreateDonation.mockResolvedValue({ did: 'don_generated' });
  // global fetch → Stripe Cloud Run service returns a checkout url
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout.stripe.com/x' }), { status: 200 })));
});

describe('POST /api/setu/donations/checkout', () => {
  it('returns 404 when the donations flag is off', async () => {
    flagState.setuDonations = false;
    const res = await POST(makeReq({ type: 'general', amountCAD: 100 }));
    expect(res.status).toBe(404);
  });

  it('returns 401 with no session', async () => {
    const res = await POST(makeReq({ type: 'general', amountCAD: 100 }, { role: '' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a family-member (non-manager)', async () => {
    const res = await POST(makeReq({ type: 'general', amountCAD: 100 }, { role: 'family-member' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 on an invalid body', async () => {
    const res = await POST(makeReq({ type: 'general' }));
    expect(res.status).toBe(400);
  });

  it('returns 503 when Stripe env is not configured', async () => {
    delete process.env.STRIPE_API_KEY;
    const res = await POST(makeReq({ type: 'general', amountCAD: 100 }));
    expect(res.status).toBe(503);
  });

  it('completes a general donation and returns the checkout url', async () => {
    const res = await POST(makeReq({ type: 'general', amountCAD: 100 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe('https://checkout.stripe.com/x');
    expect(json.did).toBe('don_generated');
    expect(mockCreateDonation).toHaveBeenCalledOnce();
    // customerEmail must come from the member record, not the client
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.customerEmail).toBe('raj@example.com');
    expect(fetchBody.successUrl).toContain('/family/donate/success?did=don_generated');
  });

  it('enforces the suggested-amount floor for bala-vihar', async () => {
    mockGetEnrollments.mockResolvedValue([
      { eid: 'fid1-pid1', status: 'active', pid: 'pid1', effectiveSuggestedAmount: 500, period: { periodLabel: 'Fall 2026' } },
    ]);
    const res = await POST(makeReq({ type: 'bala-vihar', eid: 'fid1-pid1', amountCAD: 300 }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('amount-below-suggested');
    expect(json.suggested).toBe(500);
    expect(mockCreateDonation).not.toHaveBeenCalled();
  });

  it('accepts a bala-vihar gift at or above the suggested amount', async () => {
    mockGetEnrollments.mockResolvedValue([
      { eid: 'fid1-pid1', status: 'active', pid: 'pid1', effectiveSuggestedAmount: 500, period: { periodLabel: 'Fall 2026' } },
    ]);
    const res = await POST(makeReq({ type: 'bala-vihar', eid: 'fid1-pid1', amountCAD: 750 }));
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.lineItems[0].name).toBe('Bala Vihar Donation — Fall 2026');
    expect(fetchBody.lineItems[0].amount).toBe(750);
  });

  it('returns 404 when the bala-vihar enrollment is not found', async () => {
    mockGetEnrollments.mockResolvedValue([]);
    const res = await POST(makeReq({ type: 'bala-vihar', eid: 'missing', amountCAD: 500 }));
    expect(res.status).toBe(404);
  });

  it('adds a processing-fee line item when coverFee is true', async () => {
    const res = await POST(makeReq({ type: 'general', amountCAD: 100, coverFee: true }));
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.lineItems).toHaveLength(2);
    expect(fetchBody.lineItems[1].name).toBe('Processing Fees');
    expect(fetchBody.lineItems[1].amount).toBe(2.5); // 100*0.022 + 0.30
  });

  it('returns 502 when the Stripe service errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const res = await POST(makeReq({ type: 'general', amountCAD: 100 }));
    expect(res.status).toBe(502);
  });

  it('forwards x-api-key to the Stripe service', async () => {
    await POST(makeReq({ type: 'general', amountCAD: 100 }));
    const headers = lastFetchInit().headers;
    expect(headers['x-api-key']).toBe('sk_test_x');
  });
});
