import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const fakeDoc = {
    get: vi.fn(),
    set: vi.fn(),
  };
  return {
    portalFirestore: vi.fn(() => ({
      collection: vi.fn(() => ({
        doc: vi.fn(() => fakeDoc),
      })),
    })),
  };
});

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
}));

vi.mock('@/features/check-in/notifications/send-email-service', () => ({
  sendTemplatedEmail: vi.fn(),
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyById } from '@/features/check-in/shared';
import { sendTemplatedEmail } from '@/features/check-in/notifications/send-email-service';
import { sendPaymentReminder, IDEMPOTENCY_WINDOW_MS } from '../payment-reminder-service';

function getFakeDoc() {
  const fs = (portalFirestore as unknown as ReturnType<typeof vi.fn>)();
  return fs.collection().doc();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendPaymentReminder', () => {
  it('returns not-found when family does not exist', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await sendPaymentReminder('99');
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('not-found');
  });

  it('skips when family is paid', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'paid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('paid');
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('skips when no email contact', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'phone', value: '6475550100' }],
      students: [],
    });
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('no-email');
  });

  it('skips when last reminder was within idempotency window', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    const fakeDoc = getFakeDoc();
    (fakeDoc.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: true,
      data: () => ({ lastReminderSentAt: Date.now() - 1000 }),
    });
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('throttled');
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('sends when throttle window has elapsed and updates lastReminderSentAt', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    const fakeDoc = getFakeDoc();
    (fakeDoc.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: true,
      data: () => ({ lastReminderSentAt: Date.now() - IDEMPOTENCY_WINDOW_MS - 1000 }),
    });
    (sendTemplatedEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(true);
    expect(sendTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', template: 'payment-reminder' }),
    );
    expect(fakeDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastReminderSentAt: expect.any(Number) }),
      { merge: true },
    );
  });

  it('sends the first reminder for a family that has no prior record', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    const fakeDoc = getFakeDoc();
    (fakeDoc.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ exists: false });
    (sendTemplatedEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(true);
    expect(sendTemplatedEmail).toHaveBeenCalled();
  });
});
