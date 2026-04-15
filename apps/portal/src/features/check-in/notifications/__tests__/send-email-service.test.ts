import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/aws/render-template', () => ({
  renderEmailTemplate: vi.fn((_name: string, _props: unknown) => ({
    subject: 'S',
    text: 'T',
    html: '<p>H</p>',
  })),
}));
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: vi.fn(() => ({ sendEmail: vi.fn(), sendSMS: vi.fn() })),
}));

import { renderEmailTemplate } from '@/lib/aws/render-template';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { sendTemplatedEmail } from '../send-email-service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendTemplatedEmail', () => {
  it('renders template and dispatches via resolved sender', async () => {
    const fakeSender = { sendEmail: vi.fn(), sendSMS: vi.fn() };
    (resolveSender as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(fakeSender);

    await sendTemplatedEmail({
      to: 'a@b.com',
      template: 'otp-code',
      props: { code: '123456' },
    });

    expect(renderEmailTemplate).toHaveBeenCalledWith('otp-code', { code: '123456' });
    expect(fakeSender.sendEmail).toHaveBeenCalledWith({
      to: 'a@b.com',
      subject: 'S',
      text: 'T',
      html: '<p>H</p>',
    });
  });
});
