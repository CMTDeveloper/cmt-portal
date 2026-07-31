import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRecipient, mockSend, mockClaim, mockHeaders } = vi.hoisted(() => ({
  mockRecipient: vi.fn(),
  mockSend: vi.fn(),
  mockClaim: vi.fn(),
  mockHeaders: vi.fn(),
}));
vi.mock('../bv-enrollment-emails', () => ({
  bvEmailRecipient: mockRecipient,
  sendBvDonationPendingEmail: mockSend,
}));
vi.mock('../claim-pending-email', () => ({ claimPendingEmail: mockClaim }));
vi.mock('next/headers', () => ({ headers: mockHeaders }));

import { notifyDonationPending } from '../notify-donation-pending';

const ENV = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
const MEMBERS = [{ mid: 'CMT-A-01', email: 'manager@example.org', firstName: 'A', lastName: 'B' }];

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
  mockRecipient.mockReset();
  mockRecipient.mockReturnValue({ to: 'manager@example.org', registrantName: 'A B' });
  mockSend.mockReset();
  mockSend.mockResolvedValue(undefined);
  mockClaim.mockReset();
  mockClaim.mockResolvedValue(true);
  mockHeaders.mockReset();
  // Default: a request scope whose host is the CMT preview custom domain.
  mockHeaders.mockResolvedValue(new Headers({ 'x-forwarded-host': 'setu-preview.chinmayatoronto.org' }));
});
afterEach(() => {
  if (ENV === undefined) delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
  else process.env.NEXT_PUBLIC_PORTAL_BASE_URL = ENV;
});

const ARGS = { fid: 'CMT-A', eid: 'CMT-A-bv-2026-27', members: MEMBERS, managerMids: ['CMT-A-01'] };

/**
 * The "Confirm Your Enrollment" button in CMT's `bv_enrolled_donation_pending`.
 *
 * There was NO test file here at all, which is how the link shipped pointing at
 * the wrong environment: all three triggers fire from PAGE renders, a server
 * component has no Request, and `portalBaseUrl(undefined)` skips the request
 * host entirely. Caught 2026-07-31 by reading a real delivered email.
 */
describe('notifyDonationPending — the link the family clicks', () => {
  it('uses the request host when a Request is supplied', async () => {
    const req = new Request('https://x/api/whatever', {
      headers: { 'x-forwarded-host': 'cmt-setu-preview.vercel.app' },
    });
    await notifyDonationPending({ ...ARGS, req });
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      'https://cmt-setu-preview.vercel.app/family/enroll/bala-vihar',
    );
  });

  // 🔴 THE REGRESSION. Every page-render trigger takes this path.
  it('recovers the host from next/headers when there is NO Request', async () => {
    await notifyDonationPending(ARGS);
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      'https://setu-preview.chinmayatoronto.org/family/enroll/bala-vihar',
    );
  });

  it('never points a preview deployment at production', async () => {
    await notifyDonationPending(ARGS);
    const [, link] = mockSend.mock.calls[0]!;
    expect(link).not.toContain('cmt-setu.vercel.app');
  });

  it('prefers a configured base over the request host', async () => {
    process.env.NEXT_PUBLIC_PORTAL_BASE_URL = 'https://setu.chinmayatoronto.org';
    await notifyDonationPending(ARGS);
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      'https://setu.chinmayatoronto.org/family/enroll/bala-vihar',
    );
  });

  // The payment-reminder cron has no request scope; headers() throws there.
  it('falls back to the configured base when there is no request scope at all', async () => {
    process.env.NEXT_PUBLIC_PORTAL_BASE_URL = 'https://setu.chinmayatoronto.org';
    mockHeaders.mockRejectedValue(new Error('called outside a request scope'));
    await notifyDonationPending(ARGS);
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      'https://setu.chinmayatoronto.org/family/enroll/bala-vihar',
    );
  });

  it('ignores a host nobody controls and does not build a link from it', async () => {
    mockHeaders.mockResolvedValue(new Headers({ 'x-forwarded-host': 'evil.com' }));
    await notifyDonationPending(ARGS);
    const [, link] = mockSend.mock.calls[0]!;
    expect(link).not.toContain('evil.com');
    expect(link).toBe('https://cmt-setu.vercel.app/family/enroll/bala-vihar');
  });

  it('does not claim the cooldown when there is nobody to write to', async () => {
    mockRecipient.mockReturnValue({ to: null });
    await notifyDonationPending(ARGS);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends nothing without an eid to hang the cooldown on', async () => {
    await notifyDonationPending({ ...ARGS, eid: null });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends nothing when the claim is refused', async () => {
    mockClaim.mockResolvedValue(false);
    await notifyDonationPending(ARGS);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
