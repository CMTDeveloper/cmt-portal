import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/lib/env', () => ({
  portalEnv: vi.fn(() => ({ SETU_INVITE_TTL_DAYS: 14, NEXT_PUBLIC_PORTAL_BASE_URL: 'https://portal.example.org' })),
}));

const mockCheckRate = vi.fn().mockResolvedValue({ allowed: true });
vi.mock('@/features/check-in/shared', () => ({
  checkAndRecordOtpRateLimit: (...args: unknown[]) => mockCheckRate(...args),
  LOOKUP_RATE_LIMIT_MAX: 30,
}));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
const mockSendSMS = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: () => ({ sendEmail: mockSendEmail, sendSMS: mockSendSMS }),
}));

const mockCreate = vi.fn();
vi.mock('@/features/setu/join-request/create-request', () => ({
  createJoinRequest: (...args: unknown[]) => mockCreate(...args),
}));

// Records the managed-email contract while still running the REAL
// sendManagedEmail, so the sendEmail assertions below keep exercising the
// in-code fallback rather than going quiet behind a stub.
const managedEmailCalls = vi.hoisted(
  () => [] as Array<{ name: string; to: string; data: Record<string, unknown> }>,
);
vi.mock('@/lib/aws/send-managed-email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/aws/send-managed-email')>();
  return {
    sendManagedEmail: async (args: Parameters<typeof actual.sendManagedEmail>[0]) => {
      managedEmailCalls.push({ name: args.name, to: args.to, data: args.data });
      return actual.sendManagedEmail(args);
    },
  };
});

import { POST } from '../route';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/join-request/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // A plain array, so clearAllMocks does not reach it.
  managedEmailCalls.length = 0;
  delete process.env.SES_TEMPLATE_SETU_JOIN_REQUEST;
  mockCheckRate.mockResolvedValue({ allowed: true });
});

describe('POST /api/setu/join-request/send', () => {
  it('404 when flag off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flagged } = await import('../route');
    const res = await flagged(makeRequest({ email: 'a@b.com' }));
    expect(res.status).toBe(404);
  });

  it('400 when neither email nor phone present', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('429 when rate-limited', async () => {
    mockCheckRate.mockResolvedValue({ allowed: false, resetAt: 'soon' });
    const res = await POST(makeRequest({ email: 'a@b.com' }));
    expect(res.status).toBe(429);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('happy path: creates + notifies all managers (email + SMS), returns {ok:true}', async () => {
    mockCreate.mockResolvedValue({
      outcome: 'created',
      token: 'tok123',
      fid: 'F1',
      familyName: 'Sharma Family',
      requesterEmail: 'asha@example.com',
      requesterContact: 'asha@example.com',
      requesterName: 'Asha Sharma',
      managers: [
        { email: 'raj@example.com', phone: '+14165551212', name: 'Raj' },
        { email: 'mum@example.com', phone: null, name: 'Mum' },
      ],
    });
    const res = await POST(makeRequest({ email: 'asha@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    const emailCall = mockSendEmail.mock.calls[0]![0] as { to: string; text: string };
    expect(emailCall.to).toBe('raj@example.com');
    expect(emailCall.text).toContain('/join-request/tok123');
  });

  it('hands sendManagedEmail the setu-join-request name and contract, once per manager email', async () => {
    mockCreate.mockResolvedValue({
      outcome: 'created',
      token: 'tok123',
      fid: 'F1',
      familyName: 'Sharma Family',
      requesterEmail: 'asha@example.com',
      requesterContact: 'asha@example.com',
      requesterName: 'Asha Sharma',
      managers: [
        { email: 'raj@example.com', phone: '+14165551212', name: 'Raj' },
        { email: 'mum@example.com', phone: null, name: 'Mum' },
      ],
    });

    await POST(makeRequest({ email: 'asha@example.com' }));

    expect(managedEmailCalls).toHaveLength(2);
    expect(managedEmailCalls[0]).toEqual({
      name: 'setu-join-request',
      to: 'raj@example.com',
      data: {
        requesterName: 'Asha Sharma',
        requesterContact: 'asha@example.com',
        familyName: 'Sharma Family',
        reviewUrl: expect.stringContaining('/join-request/tok123'),
      },
    });
    // Each manager gets their OWN recipient. Hoisting the wrong variable out of
    // the loop is the natural mistake when a call site gains an extra closure.
    expect(managedEmailCalls[1]!.to).toBe('mum@example.com');
  });

  it('dedupe: does NOT re-notify (no spam) but still returns {ok:true} on an existing open request', async () => {
    mockCreate.mockResolvedValue({
      outcome: 'deduped',
      token: 'existing',
      fid: 'F1',
      familyName: 'Sharma',
      requesterEmail: 'asha@example.com',
      requesterContact: 'asha@example.com',
      requesterName: undefined,
      managers: [{ email: 'raj@example.com', phone: null, name: 'Raj' }],
    });
    const res = await POST(makeRequest({ email: 'asha@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Default path (e.g. /register's first send): an open request already
    // exists, so the managers are not pinged again.
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  // ── The re-send button has to actually re-send ────────────────────────────
  //
  // verify-code now creates the request the moment a gated member proves
  // contact ownership, so by the time the pending screen renders its "Re-send
  // request to my manager" button, an open request ALWAYS exists. Without the
  // flag every click would take the dedupe path above and the UI would report
  // "Request sent." over a send that never happened - the same false claim this
  // whole change set exists to remove, moved one screen later.
  it('re-send: an EXPLICIT resend DOES re-notify an existing open request', async () => {
    mockCreate.mockResolvedValue({
      outcome: 'deduped',
      token: 'existing',
      fid: 'F1',
      familyName: 'Sharma',
      requesterEmail: 'asha@example.com',
      requesterContact: 'asha@example.com',
      requesterName: 'Asha',
      managers: [{ email: 'raj@example.com', phone: null, name: 'Raj' }],
    });
    const res = await POST(makeRequest({ email: 'asha@example.com', resend: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(managedEmailCalls.at(-1)).toMatchObject({
      name: 'setu-join-request',
      to: 'raj@example.com',
      data: { reviewUrl: expect.stringContaining('/join-request/existing') },
    });
  });

  it('re-send on an unknown contact still notifies nobody', async () => {
    // `resend` widens WHEN we notify, never WHO is a valid match - otherwise it
    // would be an enumeration oracle: pass resend against any address and watch
    // whether a manager gets mail.
    mockCreate.mockResolvedValue({ outcome: 'noop' });
    const res = await POST(makeRequest({ email: 'stranger@example.com', resend: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it('noop (manager/active/unknown contact): no notify, still {ok:true}', async () => {
    mockCreate.mockResolvedValue({ outcome: 'noop' });
    const res = await POST(makeRequest({ email: 'mgr@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it('still {ok:true} when a notification send throws (anti-enumeration)', async () => {
    mockCreate.mockResolvedValue({
      outcome: 'created',
      token: 'tok',
      fid: 'F1',
      familyName: 'Sharma',
      requesterEmail: 'asha@example.com',
      requesterContact: 'asha@example.com',
      requesterName: 'Asha',
      managers: [{ email: 'raj@example.com', phone: null, name: 'Raj' }],
    });
    mockSendEmail.mockRejectedValueOnce(new Error('SES down'));
    const res = await POST(makeRequest({ email: 'asha@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
