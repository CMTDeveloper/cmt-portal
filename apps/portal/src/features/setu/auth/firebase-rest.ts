export type PasswordSignInResult =
  | { ok: true; uid: string; email: string; idToken: string; refreshToken: string }
  | { ok: false; error: 'invalid-credentials' | 'user-disabled' | 'too-many-requests' | 'no-password' | 'network' };

const INVALID_CREDS = new Set([
  'INVALID_LOGIN_CREDENTIALS',
  'INVALID_PASSWORD',
  'EMAIL_NOT_FOUND',
  'MISSING_PASSWORD',
]);

export async function firebaseSignInWithPassword(args: {
  email: string;
  password: string;
}): Promise<PasswordSignInResult> {
  const apiKey = process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'network' };
  }

  let res: Response;
  try {
    res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: args.email, password: args.password, returnSecureToken: true }),
      },
    );
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.ok) {
    const json = (await res.json()) as {
      localId: string;
      email: string;
      idToken: string;
      refreshToken: string;
    };
    return {
      ok: true,
      uid: json.localId,
      email: json.email,
      idToken: json.idToken,
      refreshToken: json.refreshToken,
    };
  }

  const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
  const msg = body.error?.message ?? '';

  if (INVALID_CREDS.has(msg)) return { ok: false, error: 'invalid-credentials' };
  if (msg === 'USER_DISABLED') return { ok: false, error: 'user-disabled' };
  if (msg.startsWith('TOO_MANY_ATTEMPTS_TRY_LATER')) return { ok: false, error: 'too-many-requests' };
  if (msg === 'NO_PASSWORD') return { ok: false, error: 'no-password' };

  return { ok: false, error: 'network' };
}
