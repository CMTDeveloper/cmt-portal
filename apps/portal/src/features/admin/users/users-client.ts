import type { SevakRow, GrantRoleBody, RevokeRoleBody } from '@cmt/shared-domain';

// Client/server boundary wrappers for the Users & Roles screen. The page's
// 'use client' components import THESE — never the server manage-roles module
// (next/headers + firebase-admin are server-only). Each throws on a non-OK
// response so the UI's catch block fires an error toast (mirrors the
// welcome-search client pattern). The thrown Error's `.message` carries the
// API error code (e.g. 'last-admin', 'self-lockout') for a specific toast.

async function errorCodeFrom(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `http-${res.status}`;
}

export async function listSevaksClient(): Promise<SevakRow[]> {
  const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(await errorCodeFrom(res));
  }
  const data = (await res.json()) as { sevaks: SevakRow[] };
  return data.sevaks;
}

export async function grantRoleClient(body: GrantRoleBody): Promise<void> {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await errorCodeFrom(res));
  }
}

export async function revokeRoleClient(body: RevokeRoleBody): Promise<void> {
  const res = await fetch('/api/admin/users/roles', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await errorCodeFrom(res));
  }
}
