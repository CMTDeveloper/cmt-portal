import { z } from 'zod';

// Portal Firebase project (Firestore + Auth — UAT in dev, prod in prod)
export const portalAdminEnvSchema = z.object({
  PORTAL_FIREBASE_PROJECT_ID: z.string().min(1),
  PORTAL_FIREBASE_CLIENT_EMAIL: z.string().email(),
  PORTAL_FIREBASE_PRIVATE_KEY: z.string().min(1),
});
export type PortalAdminEnv = z.infer<typeof portalAdminEnvSchema>;

export const portalClientEnvSchema = z.object({
  NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID: z.string().min(1),
});
export type PortalClientEnv = z.infer<typeof portalClientEnvSchema>;

// Master Firebase project (RTDB reads — always prod)
export const masterAdminEnvSchema = z.object({
  MASTER_FIREBASE_PROJECT_ID: z.string().min(1),
  MASTER_FIREBASE_CLIENT_EMAIL: z.string().email(),
  MASTER_FIREBASE_PRIVATE_KEY: z.string().min(1),
  MASTER_FIREBASE_DATABASE_URL: z.string().url(),
});
export type MasterAdminEnv = z.infer<typeof masterAdminEnvSchema>;

export const masterClientEnvSchema = z.object({
  NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: z.string().url(),
});
export type MasterClientEnv = z.infer<typeof masterClientEnvSchema>;

export function readPortalAdminEnv(): PortalAdminEnv {
  const parsed = portalAdminEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.errors.map((e) => e.path.join('.')).join(', ');
    throw new Error(
      `[firebase-shared] Missing or invalid portal admin env vars: ${missing}. ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function readMasterAdminEnv(): MasterAdminEnv {
  const parsed = masterAdminEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.errors.map((e) => e.path.join('.')).join(', ');
    throw new Error(
      `[firebase-shared] Missing or invalid master admin env vars: ${missing}. ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
