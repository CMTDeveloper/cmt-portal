import { z } from 'zod';

const flagString = z.enum(['true', 'false']).default('false');

export const portalEnvSchema = z.object({
  // Portal Firebase (Firestore + Auth)
  PORTAL_FIREBASE_PROJECT_ID: z.string().min(1),
  PORTAL_FIREBASE_CLIENT_EMAIL: z.string().email(),
  PORTAL_FIREBASE_PRIVATE_KEY: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID: z.string().min(1),

  // Master Firebase (RTDB reads)
  MASTER_FIREBASE_PROJECT_ID: z.string().min(1),
  MASTER_FIREBASE_CLIENT_EMAIL: z.string().email(),
  MASTER_FIREBASE_PRIVATE_KEY: z.string().min(1),
  MASTER_FIREBASE_DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: z.string().url(),

  // Auth
  TEACHER_PASSPHRASE: z.string().min(6),
  SESSION_COOKIE_EXPIRES_DAYS: z.coerce.number().int().min(1).max(14).default(5),

  // AWS (declared now; real consumers in slice B5)
  AWS_SES_REGION: z.string().default('ca-central-1'),
  AWS_SNS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_SES_FROM_EMAIL: z.string().email().optional(),

  // Cron auth (slice B5)
  CRON_SECRET: z.string().min(16).optional(),

  // Feature flags
  NEXT_PUBLIC_FEATURE_CHECK_IN: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY: flagString,

  // Feature flags — events
  NEXT_PUBLIC_FEATURE_EVENTS: flagString,
  NEXT_PUBLIC_FEATURE_EVENTS_REGISTER: flagString,

  // Events — public
  NEXT_PUBLIC_EVENT_CAMPAIGN: z.string().default('2026MothersDay'),
  NEXT_PUBLIC_EVENT_DISPLAY_NAME: z.string().optional(),
  NEXT_PUBLIC_PRICE_PER_PERSON: z.coerce.number().int().min(1).default(10),
  NEXT_PUBLIC_ENABLE_STRIPE: flagString,
  NEXT_PUBLIC_EVENT_POSTER_URL: z.string().url().optional(),
  NEXT_PUBLIC_ETRANSFER_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_GOOGLE_SHEET_URL: z.string().url().optional(),

  // Events — server-only
  STRIPE_CHECKOUT_URL: z.string().url().optional(),
  STRIPE_API_KEY: z.string().min(1).optional(),
  WEBHOOK_API_KEY: z.string().min(1).optional(),
  EVENT_REGISTRATION_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(5),
});

export type PortalEnv = z.infer<typeof portalEnvSchema>;

let cached: PortalEnv | undefined;
export function portalEnv(): PortalEnv {
  if (cached) return cached;
  const parsed = portalEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`[portal] Invalid env vars: ${missing}\n${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}
