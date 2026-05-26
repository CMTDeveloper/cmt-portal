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
  // Firebase Auth's createSessionCookie has a hard 14-day max — anything
  // above that throws auth/invalid-session-cookie-duration. Don't bump this
  // above 14 without first replacing the Firebase session cookie with a
  // refresh-token rotation flow.
  SESSION_COOKIE_EXPIRES_DAYS: z.coerce.number().int().min(1).max(14).default(14),

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
  NEXT_PUBLIC_FEATURE_SETU_AUTH: flagString,

  // Portal public URL (used for invite links, etc.)
  NEXT_PUBLIC_PORTAL_BASE_URL: z.string().url().optional(),

  // Setu OTP
  SETU_OTP_TTL_MIN: z.coerce.number().int().min(5).max(30).default(10),
  SETU_OTP_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(5),
  SETU_INVITE_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),

  // UAT safety nets: comma-separated allowlists of recipients that may
  // receive REAL email/SMS. Anything else routes to mockSender even when
  // NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=true. Empty / unset means prod
  // behavior (no filter — everyone gets real mail). Read directly from
  // process.env in resolveSender(); listed here for schema completeness.
  SETU_EMAIL_ALLOWLIST: z.string().optional(),
  SETU_PHONE_ALLOWLIST: z.string().optional(),

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
