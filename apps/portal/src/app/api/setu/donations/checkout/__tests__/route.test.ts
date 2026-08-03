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

// The double-charge guard reads the family's pledge. Unmocked it reaches
// Firestore Admin and every enrollment test dies on missing env vars, which is
// exactly how this mock came to be needed.
const mockGetFamilyPledge = vi.fn();
vi.mock('@/features/setu/pledges/get-family-pledge', () => ({
  getFamilyPledge: (...a: unknown[]) => mockGetFamilyPledge(...a),
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
    // `host`, not just `origin`. resolveOrigin deliberately ignores the
    // caller-supplied Origin header (see the route), and a platform always sets
    // host - a fixture without one was testing a request shape that cannot
    // reach production.
    host: 'localhost:3000',
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

// The default family has ONE active Bala Vihar enrollment. Before 2026-08-03
// most of these fixtures used `type:'general'`, which needed no enrollment at
// all - that type is gone, so the ordinary case is now an enrollment gift.
const DEFAULT_BV = [
  { eid: 'fid1-oid1', status: 'active', oid: 'oid1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026', effectiveSuggestedAmount: 500, offering: { programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026' } },
];
/** The ordinary at-the-floor Bala Vihar gift. */
const BV_GIFT = { type: 'enrollment', eid: 'fid1-oid1', amountCAD: 500 };

beforeEach(() => {
  vi.clearAllMocks();
  flagState.setuDonations = true;
  mockGetEnrollments.mockResolvedValue(DEFAULT_BV);
  // No pledge by default - the ordinary family.
  mockGetFamilyPledge.mockResolvedValue(null);
  process.env.STRIPE_API_KEY = 'sk_test_x';
  process.env.STRIPE_CHECKOUT_URL = 'https://stripe-svc.example.com/checkout-link';
  process.env.STRIPE_USE_TEST_CHECKOUT = 'false';
  process.env.NEXT_PUBLIC_PORTAL_BASE_URL = 'http://localhost:3000';

  mockGetFamilyByFid.mockResolvedValue({
    family: { fid: 'fid1', name: 'Patel', location: 'Brampton' },
    members: [DONOR],
  });
  mockCreateDonation.mockResolvedValue({ did: 'don_generated' });
  // global fetch → Stripe Cloud Run service returns { checkoutUrl, sessionId }
  // (the REAL response shape — verified against the live test endpoint).
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/x', sessionId: 'cs_test_x' }), { status: 200 })));
});

describe('POST /api/setu/donations/checkout', () => {
  it('returns 404 when the donations flag is off', async () => {
    flagState.setuDonations = false;
    const res = await POST(makeReq(BV_GIFT));
    expect(res.status).toBe(404);
  });

  it('returns 401 with no session', async () => {
    const res = await POST(makeReq(BV_GIFT, { role: '' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a family-member (non-manager)', async () => {
    const res = await POST(makeReq(BV_GIFT, { role: 'family-member' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 on an invalid body', async () => {
    const res = await POST(makeReq({ type: 'enrollment' })); // no eid, no amount
    expect(res.status).toBe(400);
  });

  it('returns 503 when Stripe env is not configured', async () => {
    delete process.env.STRIPE_API_KEY;
    const res = await POST(makeReq(BV_GIFT));
    expect(res.status).toBe(503);
  });

  // ── The metadata CMT's accounting reports on ──────────────────────────────
  //
  // Read off the real outgoing request body (lastFetchInit), never off a mocked
  // helper call: the 2026-08-01 review caught exactly that - a route-level
  // assertion proving a value reached a mock, not Stripe.
  //
  // What shipped until 2026-08-03 was `campaign: 'setu'` - the SOURCE in the
  // CAMPAIGN field. So on every live donation the campaign was never populated
  // and the source was never sent, and nothing anywhere failed.
  it('sends campaign=BalaViharDonation + source=setu on the wire', async () => {
    await POST(makeReq(BV_GIFT));
    const body = JSON.parse(lastFetchInit().body);
    expect(body.metadata.campaign).toBe('BalaViharDonation');
    expect(body.metadata.source).toBe('setu');
    expect(body.metadata.programKey).toBe('bala-vihar');
    // The two family identifiers stay - support and reconciliation match on fid,
    // and familyId is the human-readable form.
    expect(body.metadata.fid).toBe('fid1');
    expect(body.metadata.familyId).toMatch(/^FID-/);
  });

  it('never labels a NON-Bala-Vihar gift as Bala Vihar', async () => {
    // A Tabla gift stamped BalaViharDonation lands in the wrong report and
    // nobody reconciling either one sees a discrepancy. It must also NOT be
    // refused - paymentSourceOf() defaults to 'portal', so a non-BV offering is
    // payable today and a refusal would stop money CMT wants.
    mockGetEnrollments.mockResolvedValue([
      { eid: 'fid1-tabla', status: 'active', oid: 'tabla-1', programKey: 'tabla', programLabel: 'Tabla classes', termLabel: 'Fall 2026', effectiveSuggestedAmount: 200, offering: { programKey: 'tabla', programLabel: 'Tabla classes', termLabel: 'Fall 2026' } },
    ]);
    const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-tabla', amountCAD: 200 }));
    expect(res.status).toBe(200);
    const body = JSON.parse(lastFetchInit().body);
    expect(body.metadata.campaign).not.toBe('BalaViharDonation');
    expect(body.metadata.programKey).toBe('tabla');
    expect(body.metadata.source).toBe('setu');
  });

  it('completes an enrollment donation and returns the checkout url', async () => {
    const res = await POST(makeReq(BV_GIFT));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe('https://checkout.stripe.com/x');
    expect(json.did).toBe('don_generated');
    expect(mockCreateDonation).toHaveBeenCalledOnce();
    // customerEmail must come from the member record, not the client
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.customerEmail).toBe('raj@example.com');
    expect(fetchBody.successUrl).toContain('/donate/success?did=don_generated');
  });

  it('enforces the suggested-amount floor for an enrollment donation', async () => {
    mockGetEnrollments.mockResolvedValue([
      { eid: 'fid1-oid1', status: 'active', oid: 'oid1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026', effectiveSuggestedAmount: 500, offering: { programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026' } },
    ]);
    const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-oid1', amountCAD: 300 }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('amount-below-suggested');
    expect(json.suggested).toBe(500);
    expect(mockCreateDonation).not.toHaveBeenCalled();
  });

  it('accepts an enrollment gift at or above the suggested amount and labels it by program', async () => {
    mockGetEnrollments.mockResolvedValue([
      { eid: 'fid1-oid1', status: 'active', oid: 'oid1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026', effectiveSuggestedAmount: 500, offering: { programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026' } },
    ]);
    const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-oid1', amountCAD: 750 }));
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.lineItems[0].name).toBe('Bala Vihar Donation — Fall 2026');
    expect(fetchBody.lineItems[0].amount).toBe(750);
    // the donation record carries the real program identity
    expect(mockCreateDonation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'enrollment', programKey: 'bala-vihar', programLabel: 'Bala Vihar' }),
    );
  });

  // ── 🔴 The double-charge guard ─────────────────────────────────────────────
  //
  // A monthly pledge IS the Bala Vihar enrollment donation, so a family cannot
  // also be charged the one-time amount - both would be debited and the portal
  // can undo neither. Three SCREENS suppress the control, and one of them
  // (`/family/donate?eid=`, which renders the actual payment form) was missed
  // entirely for weeks. These tests cover the layer that cannot be routed
  // around, whatever any screen forgets.
  describe('a pledge already covers the Bala Vihar enrollment donation', () => {
    const BV_ENROLLMENT = [
      { eid: 'fid1-oid1', status: 'active', oid: 'oid1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026', effectiveSuggestedAmount: 500, offering: { programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026' } },
    ];

    it('refuses the one-time charge while a mandate is still CONFIRMING', async () => {
      // `started`, not `active` - the days-long confirmation gap IS the exposure
      // window, and `isPledgeGiving()` (active-only) is what let this through.
      mockGetEnrollments.mockResolvedValue(BV_ENROLLMENT);
      mockGetFamilyPledge.mockResolvedValue({ status: 'started' });

      const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-oid1', amountCAD: 500 }));

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('pledge-covers-enrollment');
      expect(mockCreateDonation).not.toHaveBeenCalled();
    });

    it('refuses the one-time charge when the plan is already LIVE', async () => {
      mockGetEnrollments.mockResolvedValue(BV_ENROLLMENT);
      mockGetFamilyPledge.mockResolvedValue({ status: 'active' });

      const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-oid1', amountCAD: 500 }));

      expect(res.status).toBe(409);
      expect(mockCreateDonation).not.toHaveBeenCalled();
    });

    it('allows the charge again once a mandate has FAILED', async () => {
      // Nobody may be stranded: a failed mandate takes no money, so the one-time
      // route must reopen or the family cannot pay at all.
      mockGetEnrollments.mockResolvedValue(BV_ENROLLMENT);
      mockGetFamilyPledge.mockResolvedValue({ status: 'failed' });

      const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-oid1', amountCAD: 500 }));

      expect(res.status).toBe(200);
    });

    it('allows the charge again after a CANCELLED pledge', async () => {
      mockGetEnrollments.mockResolvedValue(BV_ENROLLMENT);
      mockGetFamilyPledge.mockResolvedValue({ status: 'cancelled' });

      const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-oid1', amountCAD: 500 }));

      expect(res.status).toBe(200);
    });

    it('REFUSES type:"general" outright - the type was retired 2026-08-03', async () => {
      // Until this the branch was merely unreachable from the UI: /family/donate
      // redirects home without an eid. But an authenticated manager could still
      // hand-POST it and mint a REAL Stripe checkout, now under a campaign
      // nobody had defined. A dead branch that can still take money is not dead.
      mockGetFamilyPledge.mockResolvedValue(null);

      const res = await POST(makeReq({ type: 'general', amountCAD: 100 }));

      expect(res.status).toBe(400);
      expect(mockCreateDonation).not.toHaveBeenCalled();
    });

    it('never blocks a NON-Bala-Vihar enrollment - the pledge does not fund it', async () => {
      mockGetEnrollments.mockResolvedValue([
        { eid: 'fid1-tabla', status: 'active', oid: 'tabla-1', programKey: 'tabla', programLabel: 'Tabla classes', termLabel: 'Fall 2026', effectiveSuggestedAmount: 200, offering: { programKey: 'tabla', programLabel: 'Tabla classes', termLabel: 'Fall 2026' } },
      ]);
      mockGetFamilyPledge.mockResolvedValue({ status: 'active' });

      const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-tabla', amountCAD: 200 }));

      expect(res.status).toBe(200);
    });
  });

  it('blocks Stripe checkout for teacher-managed enrollments', async () => {
    mockGetEnrollments.mockResolvedValue([
      {
        eid: 'fid1-teacher-managed',
        status: 'active',
        oid: 'teacher-managed-offering',
        programKey: 'tabla',
        programLabel: 'Tabla classes',
        termLabel: '2026-27',
        effectiveSuggestedAmount: 300,
        offering: {
          programKey: 'tabla',
          programLabel: 'Tabla classes',
          termLabel: '2026-27',
          paymentSource: 'teacher-managed',
        },
      },
    ]);

    const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-teacher-managed', amountCAD: 300 }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('payment-source-teacher-managed');
    expect(mockCreateDonation).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('labels a non-BV program donation after its own program', async () => {
    mockGetEnrollments.mockResolvedValue([
      { eid: 'fid1-tabla', status: 'active', oid: 'tabla-brampton-2026-27', programKey: 'tabla', programLabel: 'Tabla classes', termLabel: '2026-27', effectiveSuggestedAmount: 0, offering: { programKey: 'tabla', programLabel: 'Tabla classes', termLabel: '2026-27' } },
    ]);
    const res = await POST(makeReq({ type: 'enrollment', eid: 'fid1-tabla', amountCAD: 50 }));
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.lineItems[0].name).toBe('Tabla classes Donation — 2026-27');
    expect(mockCreateDonation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'enrollment', programKey: 'tabla', programLabel: 'Tabla classes' }),
    );
  });

  it('returns 404 when the enrollment is not found', async () => {
    mockGetEnrollments.mockResolvedValue([]);
    const res = await POST(makeReq({ type: 'enrollment', eid: 'missing', amountCAD: 500 }));
    expect(res.status).toBe(404);
  });

  it('adds a processing-fee line item when coverFee is true', async () => {
    const res = await POST(makeReq({ ...BV_GIFT, coverFee: true }));
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.lineItems).toHaveLength(2);
    expect(fetchBody.lineItems[1].name).toBe('Processing Fees');
    expect(fetchBody.lineItems[1].amount).toBe(11.3); // 500*0.022 + 0.30
  });

  it('returns 502 when the Stripe service errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const res = await POST(makeReq(BV_GIFT));
    expect(res.status).toBe(502);
  });

  it('forwards x-api-key to the Stripe service', async () => {
    await POST(makeReq(BV_GIFT));
    const headers = lastFetchInit().headers;
    expect(headers['x-api-key']).toBe('sk_test_x');
  });

  it('accepts the cmt-setu.vercel.app deployment origin without a base-url env', async () => {
    // Regression: the origin allowlist used to match only cmt-portal*.vercel.app,
    // so checkout failed with invalid-origin on the real cmt-setu domain.
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    const req = new Request('https://cmt-setu.vercel.app/api/setu/donations/checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://cmt-setu.vercel.app',
        'x-forwarded-host': 'cmt-setu.vercel.app',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': `10.0.0.${++ipCounter}`,
        'x-portal-role': 'family-manager',
        'x-portal-fid': 'fid1',
        'x-portal-mid': 'fid1-01',
      },
      body: JSON.stringify(BV_GIFT),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.successUrl).toBe('https://cmt-setu.vercel.app/donate/success?did=don_generated');
  });

  // Vaibhav, 2026-07-30, of the CMT custom domain he stood up for preview: the
  // allowlist knew only *.vercel.app, so this route - which fails CLOSED on an
  // unrecognised origin - would have refused the donation outright, and the
  // pledge flow returned the family to production.
  /** A request shaped the way the platform delivers one: host set, no Origin. */
  function hostReq(headers: Record<string, string>): Request {
    return new Request('https://x/api/setu/donations/checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `10.0.0.${++ipCounter}`,
        'x-portal-role': 'family-manager',
        'x-portal-fid': 'fid1',
        'x-portal-mid': 'fid1-01',
        ...headers,
      },
      body: JSON.stringify(BV_GIFT),
    });
  }

  it('accepts a CMT custom domain without a base-url env', async () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    // No `origin` header: the return url must come from the PLATFORM-set host.
    const res = await POST(hostReq({ 'x-forwarded-host': 'setu-preview.chinmayatoronto.org' }));
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.successUrl).toBe(
      'https://setu-preview.chinmayatoronto.org/donate/success?did=don_generated',
    );
    expect(fetchBody.cancelUrl).toBe(
      'https://setu-preview.chinmayatoronto.org/family/donate/cancel?did=don_generated',
    );
  });

  it('refuses a host nobody controls, and says WHY', async () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    const res = await POST(hostReq({ 'x-forwarded-host': 'evil.com' }));
    // The specific status AND reason: asserting merely "not 200" would pass on a
    // 401/429/500 and prove nothing about the origin check.
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-origin' });
  });

  // 🔴 The caller-supplied Origin must not steer the money. CMT runs OTHER apps
  // on chinmayatoronto.org, so once the allowlist covered that domain an Origin
  // header naming a sibling app became allowlisted too.
  it('IGNORES the Origin header and uses the platform host', async () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    const res = await POST(
      hostReq({
        origin: 'https://events.chinmayatoronto.org',
        'x-forwarded-host': 'setu-preview.chinmayatoronto.org',
      }),
    );
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.successUrl).toContain('https://setu-preview.chinmayatoronto.org/');
    expect(fetchBody.successUrl).not.toContain('events.chinmayatoronto.org');
  });

  // The old private allowlist tested the whole ORIGIN (`^https://...`), so moving
  // to a hostname predicate could have silently accepted http:// and odd ports.
  // The origin is rebuilt rather than echoed, so neither survives.
  it('forces https and drops a port on a trusted host', async () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    const res = await POST(
      hostReq({
        origin: 'http://setu.chinmayatoronto.org',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'setu.chinmayatoronto.org:8443',
      }),
    );
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.successUrl).toBe(
      'https://setu.chinmayatoronto.org/donate/success?did=don_generated',
    );
  });

  // A configured base is an operator decision and outranks the request host.
  it('prefers the configured base over the request host', async () => {
    process.env.NEXT_PUBLIC_PORTAL_BASE_URL = 'https://setu.chinmayatoronto.org';
    const res = await POST(hostReq({ 'x-forwarded-host': 'cmt-setu.vercel.app' }));
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(lastFetchInit().body);
    expect(fetchBody.successUrl).toBe(
      'https://setu.chinmayatoronto.org/donate/success?did=don_generated',
    );
  });
});
