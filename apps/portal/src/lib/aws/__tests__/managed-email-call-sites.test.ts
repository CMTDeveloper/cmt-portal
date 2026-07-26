import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The variable contract for each migrated email, asserted at its REAL call site.
 *
 * These names cross the SES boundary as an untyped JSON blob, so TypeScript
 * cannot check them: rename `familyName` here and every affected template
 * renders a blank with no compile error and no runtime error. Deep-equality on
 * `data` is the only thing standing in for a type.
 *
 * The existing suites for these files cannot cover this. They do not mock
 * sendManagedEmail, so after the migration the real one runs, finds no
 * SES_TEMPLATE_* in the test env, and takes the fallback into the still-mocked
 * sendTemplatedEmail - passing whether the migration happened, happened wrong,
 * or never happened at all.
 */

const mockSendManagedEmail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/aws/send-managed-email', () => ({ sendManagedEmail: mockSendManagedEmail }));

const mockSendTemplatedEmail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/features/check-in/notifications/send-email-service', () => ({
  sendTemplatedEmail: mockSendTemplatedEmail,
}));

const mockFindFamilyById = vi.hoisted(() => vi.fn());
vi.mock('@/features/check-in/shared', () => ({ findFamilyById: mockFindFamilyById }));

const mockDocRef = vi.hoisted(() => ({
  get: vi.fn(async () => ({ exists: false, data: () => undefined })),
  set: vi.fn(async () => {}),
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => ({ doc: () => mockDocRef }) }),
}));

interface ManagedArgs {
  name: string;
  to: string;
  data: Record<string, unknown>;
  fallback: () => Promise<void>;
}

/** The args of the first sendManagedEmail call. The mock is declared without a
 *  parameter type, so read it through here rather than indexing an empty tuple. */
function firstManagedCall(): ManagedArgs {
  return (mockSendManagedEmail.mock.calls[0] as unknown as [ManagedArgs])[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDocRef.get.mockResolvedValue({ exists: false, data: () => undefined });
});

describe('payment-reminder call site', () => {
  it('hands sendManagedEmail the payment-reminder name and its exact data', async () => {
    mockFindFamilyById.mockResolvedValue({
      name: 'Patel',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'p@example.com' }],
    });
    const { sendPaymentReminder } = await import(
      '@/features/check-in/notifications/payment-reminder-service'
    );

    const result = await sendPaymentReminder('FAM001');

    expect(result.sent).toBe(true);
    expect(mockSendManagedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'payment-reminder',
        to: 'p@example.com',
        data: { familyName: 'Patel' },
      }),
    );
  });

  it('its fallback is the in-code renderer, not a second managed send', async () => {
    // The safety net: whatever sendManagedEmail decides, the fallback it is
    // handed must reach sendTemplatedEmail with the SAME recipient and props.
    mockFindFamilyById.mockResolvedValue({
      name: 'Patel',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'p@example.com' }],
    });
    const { sendPaymentReminder } = await import(
      '@/features/check-in/notifications/payment-reminder-service'
    );

    await sendPaymentReminder('FAM001');
    await firstManagedCall().fallback();

    expect(mockSendTemplatedEmail).toHaveBeenCalledWith({
      to: 'p@example.com',
      template: 'payment-reminder',
      props: { familyName: 'Patel' },
    });
  });

  it('does NOT record lastReminderSentAt when the send throws', async () => {
    // The idempotency window is written after the send on purpose, so a failed
    // reminder is retried by the next cron rather than silently skipped.
    mockFindFamilyById.mockResolvedValue({
      name: 'Patel',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'p@example.com' }],
    });
    mockSendManagedEmail.mockRejectedValueOnce(new Error('SES down'));
    const { sendPaymentReminder } = await import(
      '@/features/check-in/notifications/payment-reminder-service'
    );

    await expect(sendPaymentReminder('FAM001')).rejects.toThrow(/SES down/);
    expect(mockDocRef.set).not.toHaveBeenCalled();
  });
});

describe('donation-thank-you call site', () => {
  it('migrates donation-thank-you with the caller props as data', async () => {
    const { POST } = await import('@/app/api/check-in/notifications/send-email/route');

    const res = await POST(
      new Request('http://localhost/api/check-in/notifications/send-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: 'd@example.com',
          template: 'donation-thank-you',
          props: { familyName: 'Patel', amount: '108.00' },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockSendManagedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'donation-thank-you',
        to: 'd@example.com',
        data: { familyName: 'Patel', amount: '108.00' },
      }),
    );
  });

  it('leaves otp-code on the in-code renderer', async () => {
    // The single most important assertion in this file. This route dispatches
    // OTP as well, and routing it through SES would put every sign-in behind a
    // template edit nobody reviews.
    const { POST } = await import('@/app/api/check-in/notifications/send-email/route');

    await POST(
      new Request('http://localhost/api/check-in/notifications/send-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'o@example.com', template: 'otp-code', props: { code: '123456' } }),
      }),
    );

    expect(mockSendManagedEmail).not.toHaveBeenCalled();
    expect(mockSendTemplatedEmail).toHaveBeenCalledWith({
      to: 'o@example.com',
      template: 'otp-code',
      props: { code: '123456' },
    });
  });

  it('leaves payment-reminder on the in-code renderer HERE, since its real caller is migrated at source', async () => {
    const { POST } = await import('@/app/api/check-in/notifications/send-email/route');

    await POST(
      new Request('http://localhost/api/check-in/notifications/send-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: 'p@example.com',
          template: 'payment-reminder',
          props: { familyName: 'Patel' },
        }),
      }),
    );

    expect(mockSendManagedEmail).not.toHaveBeenCalled();
    expect(mockSendTemplatedEmail).toHaveBeenCalled();
  });
});
