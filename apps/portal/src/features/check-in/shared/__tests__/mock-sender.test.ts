import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSender, type NotificationSender } from '../notifications/mock-sender';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('mockSender', () => {
  it('conforms to the NotificationSender interface', () => {
    const sender: NotificationSender = mockSender;
    expect(typeof sender.sendEmail).toBe('function');
    expect(typeof sender.sendSMS).toBe('function');
  });

  it('sendEmail logs the recipient and subject without leaking the 6-digit code', async () => {
    await mockSender.sendEmail({
      to: 'a@b.com',
      subject: 'Your code',
      text: 'Your verification code is 654321. It expires in 10 minutes.',
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[mock-email]'),
      expect.objectContaining({ to: 'a@b.com', subject: 'Your code' }),
    );
    const logArg = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      preview: string;
    };
    expect(logArg.preview).toContain('******');
    expect(logArg.preview).not.toMatch(/654321/);
  });

  it('sendSMS logs phone without leaking the 6-digit code', async () => {
    await mockSender.sendSMS({ phone: '+16475550100', message: 'CMT code: 123456 (10 min)' });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[mock-sms]'),
      expect.objectContaining({ phone: '+16475550100' }),
    );
    const logArg = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      preview: string;
    };
    expect(logArg.preview).toContain('******');
    expect(logArg.preview).not.toMatch(/123456/);
  });

  it('redacts 6-digit code from sendEmail text preview', async () => {
    await mockSender.sendEmail({
      to: 'test@example.com',
      subject: 'Code',
      text: 'Your code is 654321. Have fun',
    });
    const logArg = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      preview: string;
    };
    expect(logArg.preview).toContain('******');
    expect(logArg.preview).not.toContain('654321');
  });

  it('redacts 6-digit code from sendSMS message preview', async () => {
    await mockSender.sendSMS({ phone: '+10000000000', message: 'Code: 987654' });
    const logArg = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      preview: string;
    };
    expect(logArg.preview).toContain('******');
    expect(logArg.preview).not.toContain('987654');
  });
});
