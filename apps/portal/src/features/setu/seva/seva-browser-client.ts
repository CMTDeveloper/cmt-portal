// Client-safe wrappers around the family-facing seva routes. The route handlers
// use next/headers + firebase-admin (server-only), so call THESE from the UI and
// mock THESE in component tests (not fetch directly). Mirrors the shape of
// features/admin/seva/opportunities-client.ts.

export interface SevaOppView {
  oppId: string;
  title: string;
  description: string;
  date: string;
  location: string;
  defaultHours: number;
  capacity: number | null;
  sevaYear: string;
  status: 'open' | 'closed';
  mySignupStatus: 'signed-up' | 'completed' | 'no-show' | 'cancelled' | null;
  spotsLeft: number | null;
}

export interface SevaMySignup {
  signupId: string;
  oppId: string;
  mid: string | null;
  status: string;
  hoursAwarded: number;
  signedUpAt: string;
  opportunity: { title: string; date: string; defaultHours: number } | null;
}

/** GET the open opportunity list + requirement. Degrades gracefully on error. */
export async function fetchOpportunities(): Promise<{
  opportunities: SevaOppView[];
  currentSevaYear: string | null;
  hoursPerYear: number;
  hoursEarned: number;
}> {
  const res = await fetch('/api/setu/seva/opportunities', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) return { opportunities: [], currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 };
  const data = (await res.json().catch(() => ({}))) as {
    opportunities?: SevaOppView[];
    currentSevaYear?: string | null;
    hoursPerYear?: number;
    hoursEarned?: number;
  };
  return {
    opportunities: data.opportunities ?? [],
    currentSevaYear: data.currentSevaYear ?? null,
    hoursPerYear: data.hoursPerYear ?? 20,
    hoursEarned: data.hoursEarned ?? 0,
  };
}

/** GET the current family's signups. Returns [] on error. */
export async function fetchMySignups(): Promise<SevaMySignup[]> {
  const res = await fetch('/api/setu/seva/my', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { mySignups?: SevaMySignup[] };
  return data.mySignups ?? [];
}

/**
 * POST a signup. Pass `mid = null` to credit the whole family — the API treats a
 * missing `mid` as the whole-family case, so we OMIT it from the body when null
 * (never send `mid: undefined` — exactOptionalPropertyTypes).
 */
export async function signUp(oppId: string, mid: string | null): Promise<{ ok: boolean; error?: string }> {
  const body: { oppId: string; mid?: string } = { oppId };
  if (mid !== null) body.mid = mid;
  const res = await fetch('/api/setu/seva/signups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(data.error ? { error: data.error } : {}) };
}

/** POST a cancel for an existing signup. */
export async function cancelSignup(signupId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/setu/seva/signups/${signupId}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(data.error ? { error: data.error } : {}) };
}
