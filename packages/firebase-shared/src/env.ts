import { z } from 'zod';

export const adminEnvSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_DATABASE_URL: z.string().url(),
});

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_DATABASE_URL: z.string().url(),
});

export type AdminEnv = z.infer<typeof adminEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function readAdminEnv(): AdminEnv {
  const parsed = adminEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `[firebase-shared] Missing or invalid Firebase admin env vars: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function readClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_DATABASE_URL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });
  if (!parsed.success) {
    throw new Error(
      `[firebase-shared] Missing or invalid Firebase client env vars: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
