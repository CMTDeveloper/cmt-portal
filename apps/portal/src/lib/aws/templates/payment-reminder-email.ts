import 'server-only';

export interface PaymentReminderProps {
  familyName: string;
}

export function paymentReminderEmail({ familyName }: PaymentReminderProps) {
  return {
    subject: 'Payment reminder — Chinmaya Mission Toronto',
    text: `Hari OM ${familyName}! Your family check-in has been recorded. Please see a sevak at your next visit to settle your outstanding payment. Thank you for your seva.`,
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #214a54">
  <h1 style="color: #214a54">Chinmaya Mission Toronto</h1>
  <p>Hari OM ${familyName}!</p>
  <p>Your family check-in has been recorded. Please see a sevak at your next visit to settle your outstanding payment.</p>
  <p>Thank you for your seva.</p>
</body></html>`,
  };
}
