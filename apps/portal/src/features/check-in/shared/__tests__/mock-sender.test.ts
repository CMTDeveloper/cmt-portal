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

  it('sendEmail logs the recipient, subject, and body', async () => {
    await mockSender.sendEmail({
      to: 'a@b.com',
      subject: 'Your code',
      text: 'Code: 123456',
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[mock-email]'),
      expect.objectContaining({ to: 'a@b.com', subject: 'Your code' }),
    );
  });

  it('sendSMS logs phone and message', async () => {
    await mockSender.sendSMS({ phone: '+16475550100', message: 'Code: 123456' });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[mock-sms]'),
      expect.objectContaining({ phone: '+16475550100' }),
    );
  });
});
