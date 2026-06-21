import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ses', () => ({ sendEmail: vi.fn() }));
vi.mock('../sns', () => ({ sendSMS: vi.fn() }));
vi.mock('@/features/check-in/shared', () => ({
  mockSender: {
    sendEmail: vi.fn(),
    sendSMS: vi.fn(),
  },
}));

import { sendEmail as realSendEmail } from '../ses';
import { sendSMS as realSendSMS } from '../sns';
import { mockSender } from '@/features/check-in/shared';
import { resolveSender } from '../resolve-sender';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY;
  delete process.env.SETU_EMAIL_ALLOWLIST;
  delete process.env.SETU_PHONE_ALLOWLIST;
  delete process.env.SETU_EMAIL_REDIRECT_TO;
  delete process.env.SETU_PHONE_REDIRECT_TO;
});

describe('resolveSender', () => {
  it('routes to mock when NOTIFY flag is false', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'false';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'a@b.com', subject: 's', text: 't' });
    expect(mockSender.sendEmail).toHaveBeenCalled();
    expect(realSendEmail).not.toHaveBeenCalled();
  });

  it('routes to real SES when NOTIFY flag is true', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'a@b.com', subject: 's', text: 't' });
    expect(realSendEmail).toHaveBeenCalledWith({ to: 'a@b.com', subject: 's', text: 't' });
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
  });

  it('routes SMS to real SNS when NOTIFY=true and no phone allowlist', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+1', message: 'x' });
    expect(realSendSMS).toHaveBeenCalled();
  });
});

describe('resolveSender — SETU_EMAIL_ALLOWLIST', () => {
  it('with NOTIFY=true and empty allowlist, all recipients get real mail (prod behavior)', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_EMAIL_ALLOWLIST = '';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'anyone@example.com', subject: 's', text: 't' });
    expect(realSendEmail).toHaveBeenCalled();
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
  });

  it('allowlisted recipient gets real mail', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_EMAIL_ALLOWLIST = 'dineshdm7@gmail.com';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'dineshdm7@gmail.com', subject: 's', text: 't' });
    expect(realSendEmail).toHaveBeenCalled();
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
  });

  it('non-allowlisted recipient routes to mock', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_EMAIL_ALLOWLIST = 'dineshdm7@gmail.com';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'someone-else@gmail.com', subject: 's', text: 't' });
    expect(realSendEmail).not.toHaveBeenCalled();
    expect(mockSender.sendEmail).toHaveBeenCalled();
  });

  it('email allowlist is case-insensitive and tolerates whitespace', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_EMAIL_ALLOWLIST = ' DineshDM7@Gmail.com , extra@example.com ';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'dineshdm7@gmail.com', subject: 's', text: 't' });
    expect(realSendEmail).toHaveBeenCalled();
  });

  it('email allowlist does NOT affect SMS routing', async () => {
    // The split fixed a bug where any email-only allowlist blocked SMS too.
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_EMAIL_ALLOWLIST = 'dineshdm7@gmail.com';
    // SETU_PHONE_ALLOWLIST intentionally unset → no phone filter → real SNS.
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+14379712609', message: 'x' });
    expect(realSendSMS).toHaveBeenCalled();
    expect(mockSender.sendSMS).not.toHaveBeenCalled();
  });
});

describe('resolveSender — SETU_PHONE_ALLOWLIST', () => {
  it('allowlisted phone gets real SMS (digits-only compare)', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_PHONE_ALLOWLIST = '+1 (647) 123-4567';
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+16471234567', message: 'x' });
    expect(realSendSMS).toHaveBeenCalled();
    expect(mockSender.sendSMS).not.toHaveBeenCalled();
  });

  it('non-allowlisted phone routes to mock', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_PHONE_ALLOWLIST = '16471234567';
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+19999999999', message: 'x' });
    expect(realSendSMS).not.toHaveBeenCalled();
    expect(mockSender.sendSMS).toHaveBeenCalled();
  });

  it('phone allowlist does NOT affect email routing', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_PHONE_ALLOWLIST = '14379712609';
    // SETU_EMAIL_ALLOWLIST intentionally unset → no email filter → real SES.
    const sender = resolveSender();
    await sender.sendEmail({ to: 'random@example.com', subject: 's', text: 't' });
    expect(realSendEmail).toHaveBeenCalled();
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
  });
});

describe('resolveSender — test-mode redirects', () => {
  it('SETU_EMAIL_REDIRECT_TO sends every email to the test inbox, original recipient in subject', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_EMAIL_REDIRECT_TO = 'developer@chinmayatoronto.org';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'real-family@example.com', subject: 'Your code', text: 'body' });
    expect(realSendEmail).toHaveBeenCalledWith({
      to: 'developer@chinmayatoronto.org',
      subject: '[test → real-family@example.com] Your code',
      text: 'body',
    });
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
  });

  it('email redirect overrides the allowlist (a non-allowlisted recipient is still delivered to the test inbox)', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_EMAIL_ALLOWLIST = 'someone-allowed@example.com';
    process.env.SETU_EMAIL_REDIRECT_TO = 'developer@chinmayatoronto.org';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'not-on-the-list@example.com', subject: 's', text: 't' });
    expect(realSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'developer@chinmayatoronto.org' }),
    );
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
  });

  it('SETU_PHONE_REDIRECT_TO sends every SMS to the test phone, original number in the message', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_PHONE_REDIRECT_TO = '+16473852434';
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+14165550000', message: 'CMT code: 123456' });
    expect(realSendSMS).toHaveBeenCalledWith({
      phone: '+16473852434',
      message: '[test → +14165550000] CMT code: 123456',
    });
    expect(mockSender.sendSMS).not.toHaveBeenCalled();
  });

  it('SMS redirect overrides the phone allowlist', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_PHONE_ALLOWLIST = '16470000000';
    process.env.SETU_PHONE_REDIRECT_TO = '+16473852434';
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+19999999999', message: 'x' });
    expect(realSendSMS).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+16473852434' }),
    );
    expect(mockSender.sendSMS).not.toHaveBeenCalled();
  });

  it('the redirects are independent: an email redirect does not touch SMS, and vice versa', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    process.env.SETU_EMAIL_REDIRECT_TO = 'developer@chinmayatoronto.org';
    // No SETU_PHONE_REDIRECT_TO → SMS follows normal (no-allowlist) real-send path.
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+14165550000', message: 'x' });
    expect(realSendSMS).toHaveBeenCalledWith({ phone: '+14165550000', message: 'x' });
  });

  it('redirect still requires NOTIFY enabled (NOTIFY=false → mock, nothing sent)', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'false';
    process.env.SETU_EMAIL_REDIRECT_TO = 'developer@chinmayatoronto.org';
    process.env.SETU_PHONE_REDIRECT_TO = '+16473852434';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'x@y.com', subject: 's', text: 't' });
    await sender.sendSMS({ phone: '+14165550000', message: 'x' });
    expect(realSendEmail).not.toHaveBeenCalled();
    expect(realSendSMS).not.toHaveBeenCalled();
    expect(mockSender.sendEmail).toHaveBeenCalled();
    expect(mockSender.sendSMS).toHaveBeenCalled();
  });
});
