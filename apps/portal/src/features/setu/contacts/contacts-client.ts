// Client-safe wrappers around the /api/setu/contacts/* routes. The route
// handlers use next/headers + firebase-admin, which crash in a 'use client'
// component — call these from the UI and mock THESE in component tests.

export interface ContactsResult {
  ok: boolean;
  error?: string;
  resetAt?: string;
}

export async function sendContactCode(
  type: 'email' | 'phone',
  value: string,
): Promise<ContactsResult> {
  const res = await fetch('/api/setu/contacts/send-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ type, value }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string; resetAt?: string };
  return { ok: false, ...(body.error ? { error: body.error } : {}), ...(body.resetAt ? { resetAt: body.resetAt } : {}) };
}

export async function verifyContactCode(
  type: 'email' | 'phone',
  value: string,
  code: string,
): Promise<ContactsResult> {
  const res = await fetch('/api/setu/contacts/verify-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ type, value, code }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(body.error ? { error: body.error } : {}) };
}

export async function dismissContactsNudge(): Promise<ContactsResult> {
  const res = await fetch('/api/setu/contacts/dismiss-nudge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  return res.ok ? { ok: true } : { ok: false };
}
