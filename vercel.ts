import type { VercelConfig } from '@vercel/config/v1/types';

export const config: VercelConfig = {
  crons: [
    // Daily cache reset at 00:00 UTC (parity with standalone app)
    { path: '/api/cron/reset-cache', schedule: '0 0 * * *' },
    // Weekly unpaid-family reminder sweep — Sundays 14:00 UTC
    { path: '/api/cron/send-weekly-payment-reminders', schedule: '0 14 * * 0' },
  ],
};
