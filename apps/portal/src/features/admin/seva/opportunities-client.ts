// Client-safe wrappers around the seva opportunity + requirement routes. The
// route handlers use next/headers + firebase-admin (server-only), so call THESE
// from the UI and mock THESE in component tests (not fetch directly).

export interface OppResult {
  ok: boolean;
  error?: string;
  oppId?: string;
}

export interface SerializedOpportunity {
  oppId: string;
  title: string;
  description: string;
  date: string;
  location: string;
  defaultHours: number;
  capacity: number | null;
  sevaYear: string;
  status: 'open' | 'closed' | 'draft';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface SevaRequirement {
  hoursPerYear: number;
  currentSevaYear: string | null;
}

/** GET the full opportunity list. Returns [] on error so the UI degrades gracefully. */
export async function listOpportunities(): Promise<SerializedOpportunity[]> {
  const res = await fetch('/api/welcome/seva/opportunities', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { opportunities?: SerializedOpportunity[] };
  return data.opportunities ?? [];
}

/** POST a new opportunity. `date` is a 'YYYY-MM-DD' string. */
export async function createOpportunity(input: {
  title: string;
  description?: string;
  date: string;
  location?: string;
  defaultHours: number;
  capacity?: number | null;
}): Promise<OppResult> {
  const res = await fetch('/api/welcome/seva/opportunities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { oppId?: string; error?: string };
  if (res.ok) return { ok: true, ...(data.oppId ? { oppId: data.oppId } : {}) };
  return { ok: false, ...(data.error ? { error: data.error } : {}) };
}

/** PATCH an existing opportunity with a partial set of fields. */
export async function updateOpportunity(
  oppId: string,
  patch: Record<string, unknown>,
): Promise<OppResult> {
  const res = await fetch(`/api/welcome/seva/opportunities/${oppId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch),
  });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(data.error ? { error: data.error } : {}) };
}

/** PUT the seva-hours requirement config. Admin-only on the server (403 otherwise). */
export async function saveRequirement(
  cfg: SevaRequirement,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/admin/seva/requirement', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(cfg),
  });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(data.error ? { error: data.error } : {}) };
}
