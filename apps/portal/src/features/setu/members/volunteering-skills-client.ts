// Client-safe wrappers around the member-skills routes. The route handlers use
// next/headers + firebase-admin (server-only), so call THESE from the UI and
// mock THESE in component tests.

export interface VolunteeringResult {
  ok: boolean;
  error?: string;
}

/** Save the signed-in member's volunteering skills via the self-edit PATCH. */
export async function saveVolunteeringSkills(
  mid: string,
  skills: string[],
): Promise<VolunteeringResult> {
  const res = await fetch(`/api/setu/members/${mid}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ volunteeringSkills: skills }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(body.error ? { error: body.error } : {}) };
}

/** Dismiss the one-time "set your volunteering skills" dashboard nudge. */
export async function dismissVolunteeringSkillsNudge(): Promise<VolunteeringResult> {
  const res = await fetch('/api/setu/volunteering-skills/dismiss-nudge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  return res.ok ? { ok: true } : { ok: false };
}
