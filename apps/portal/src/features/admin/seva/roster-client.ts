// Client-safe wrappers around the welcome roster + confirm routes. The route
// handlers use firebase-admin (server-only); call THESE from the UI and mock
// THESE in component tests. Mirrors features/admin/seva/opportunities-client.ts.
import type { SerializedOpportunity } from './opportunities-client';

export interface RosterRow {
  signupId: string;
  fid: string;
  familyName: string;
  mid: string | null;
  memberName: string | null;
  status: 'signed-up' | 'completed' | 'no-show';
  hoursAwarded: number;
  signedUpAt: string;
}

export interface RosterData {
  opportunity: SerializedOpportunity;
  rows: RosterRow[];
}

/** GET the roster for one opportunity. Returns null on error/404. */
export async function fetchRoster(oppId: string): Promise<RosterData | null> {
  const res = await fetch(`/api/welcome/seva/opportunities/${oppId}/signups`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as RosterData | null;
}

/** POST a confirmation. Omit hoursAwarded to let the server use the opp default. */
export async function confirmSignup(
  signupId: string,
  body: { status: 'completed' | 'no-show'; hoursAwarded?: number },
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/welcome/seva/signups/${signupId}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(data.error ? { error: data.error } : {}) };
}
