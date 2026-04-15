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

  it('routes SMS accordingly', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+1', message: 'x' });
    expect(realSendSMS).toHaveBeenCalled();
  });
});
