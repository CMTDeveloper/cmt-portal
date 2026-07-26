import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyById } from '@/features/check-in/shared';
import { sendManagedEmail } from '@/lib/aws/send-managed-email';
import { sendTemplatedEmail } from './send-email-service';

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PaymentReminderResult {
  sent: boolean;
  reason?: 'paid' | 'no-email' | 'throttled' | 'not-found';
}

export async function sendPaymentReminder(familyId: string): Promise<PaymentReminderResult> {
  const family = await findFamilyById(familyId);
  if (!family) return { sent: false, reason: 'not-found' };
  if (family.paymentStatus === 'paid') return { sent: false, reason: 'paid' };

  const email = family.contacts.find((c) => c.type === 'email')?.value;
  if (!email) return { sent: false, reason: 'no-email' };

  const ref = portalFirestore().collection('family_notifications').doc(familyId);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const data = snap.data() as { lastReminderSentAt?: number } | undefined;
    if (data?.lastReminderSentAt && now - data.lastReminderSentAt < IDEMPOTENCY_WINDOW_MS) {
      return { sent: false, reason: 'throttled' };
    }
  }

  // `lastReminderSentAt` is written AFTER the send, so a throw here leaves the
  // idempotency window unset and the next cron run retries. That is the
  // pre-existing behaviour and is preserved: neither the managed path nor the
  // fallback swallows a delivery failure.
  await sendManagedEmail({
    name: 'payment-reminder',
    to: email,
    data: { familyName: family.name },
    fallback: () =>
      sendTemplatedEmail({
        to: email,
        template: 'payment-reminder',
        props: { familyName: family.name },
      }),
  });

  await ref.set({ lastReminderSentAt: now }, { merge: true });
  return { sent: true };
}
