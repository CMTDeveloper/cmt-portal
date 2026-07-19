// Client-safe wrappers around the disclaimers routes. Call THESE from UI
// components and mock THESE in component tests (the routes use next/headers +
// firebase-admin, server-only). Both THROW on a non-OK response so the UI can
// surface an error toast (matches searchFamiliesClient).
import type { DisclaimerSection } from '@cmt/shared-domain/setu';

export interface DisclaimerContentInput {
  intro: string;
  sections: DisclaimerSection[];
  acknowledgement: string;
}

export async function acceptDisclaimersClient(): Promise<void> {
  const res = await fetch('/api/setu/disclaimers/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`accept-failed:${res.status}`);
}

export async function saveDisclaimersClient(content: DisclaimerContentInput): Promise<number> {
  const res = await fetch('/api/admin/disclaimers', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(content),
  });
  if (!res.ok) throw new Error(`save-failed:${res.status}`);
  const body = (await res.json()) as { version: number };
  return body.version;
}
