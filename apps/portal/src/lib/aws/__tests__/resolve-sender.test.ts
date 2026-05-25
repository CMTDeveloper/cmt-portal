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
