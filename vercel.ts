import type { VercelConfig } from '@vercel/config/v1/types';

export const config: VercelConfig = {
  crons: [
    // Daily cache reset at 00:00 UTC (parity with standalone app)
    { path: '/api/cron/reset-cache', schedule: '0 0 * * *' },
    // Weekly unpaid-family reminder sweep — Sundays 14:00 UTC
    { path: '/api/cron/send-weekly-payment-reminders', schedule: '0 14 * * 0' },
    // Daily prasad 7d/2d reminder sweep — 14:00 UTC (≈ 9/10am Toronto)
    { path: '/api/cron/send-prasad-reminders', schedule: '0 14 * * *' },
    // Daily monthly-pledge reconciler — 15:00 UTC. Finishes pledges whose
    // browser died between the Stripe mandate page and the subscription call.
    // Daily is enough: a pre-authorized debit settles in days, not minutes.
    // Deliberately an hour after the prasad sweep so the two do not contend.
    { path: '/api/cron/reconcile-pledges', schedule: '0 15 * * *' },
  ],
};
