// Client-safe wrapper around PATCH /api/setu/members/{mid}. A 'use client'
// component cannot call the server write path directly (it uses next/headers +
// firebase-admin), so the completion form (and any client surface) PATCHes via
// this wrapper, which is trivially mockable in component tests.
//
// Mirrors the route contract: 200 ⇒ ok; a non-OK response carries a TOP-LEVEL
// `error` CODE (e.g. 'contact-required', 'foodAllergies-required',
// 'contact-already-registered') — map it via memberWriteErrorMessage() for a
// friendly toast. `fields` is reserved for a future per-field shape (the routes
// don't emit it today); callers that read it stay forward-compatible.

export interface PatchMemberResult {
  ok: boolean;
  status: number;
  error?: string;
  fields?: Record<string, string>;
}

export async function patchMemberClient(
  mid: string,
  body: Record<string, unknown>,
): Promise<PatchMemberResult> {
  const res = await fetch(`/api/setu/members/${mid}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

  if (res.ok) return { ok: true, status: res.status };

  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    fields?: Record<string, string>;
  };
  return {
    ok: false,
    status: res.status,
    ...(json.error ? { error: json.error } : {}),
    ...(json.fields ? { fields: json.fields } : {}),
  };
}
