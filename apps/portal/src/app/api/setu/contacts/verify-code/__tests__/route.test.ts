import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  verifyCode: vi.fn(),
}));
vi.mock('@/features/setu/contacts/add-verified-contact', async () => {
  const actual = await vi.importActual<typeof import('@/features/setu/contacts/add-verified-contact')>(
    '@/features/setu/contacts/add-verified-contact',
  );
  return { ...actual, addVerifiedContact: vi.fn() };
});
// E2E discipline: mutation routes call revalidateTag → must be mocked or the
// route throws "static generation store missing" in the harness.
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { POST } from '../route';
import { verifyCode } from '@/features/check-in/shared';
import { addVerifiedContact, ContactInUseError } from '@/features/setu/contacts/add-verified-contact';

// The route authenticates from the middleware-set x-portal-* headers (cookie
// AND Bearer/mobile sessions). Pass session: null for a signed-out request.
const SIGNED_IN = { role: 'family-member', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02' };

function makeRequest(body: unknown, session: typeof SIGNED_IN | null = SIGNED_IN) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  return new Request('http://localhost/api/setu/contacts/verify-code', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (addVerifiedContact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe('POST /api/setu/contacts/verify-code', () => {
  it('returns 401 when not signed in', async () => {
    const res = await POST(makeRequest({ type: 'email', value: 'x@example.com', code: '123456' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 400 on an invalid/expired code', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(makeRequest({ type: 'email', value: 'x@example.com', code: '000000' }));
    expect(res.status).toBe(400);
    expect(addVerifiedContact).not.toHaveBeenCalled();
  });

  it('on success calls addVerifiedContact with the current member binding', async () => {
    const res = await POST(makeRequest({ type: 'email', value: 'priya.work@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    expect(addVerifiedContact).toHaveBeenCalledWith({
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      type: 'email',
      value: 'priya.work@example.com',
    });
  });

  it('returns 409 when the contact is already in use by another member', async () => {
    (addVerifiedContact as ReturnType<typeof vi.fn>).mockRejectedValue(new ContactInUseError());
    const res = await POST(makeRequest({ type: 'phone', value: '4165550200', code: '123456' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('contact-in-use');
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ type: 'email', value: 'x@example.com', code: '123456' }));
    expect(res.status).toBe(404);
  });
});
