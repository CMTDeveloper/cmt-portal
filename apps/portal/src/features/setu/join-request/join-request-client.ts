// Client → server fetch wrappers for the gated co-manager join-request flow.
// Client components MUST call these instead of importing any server-only module
// (next/headers, firebase-admin). Each wrapper hits a /api/setu/join-request/*
// route whose request/response shape is fixed by the Task-7 CONTRACT.

// ── POST /api/setu/join-request/send ─────────────────────────────────────────
// Open + IP rate-limited. ALWAYS resolves { ok: true } for a well-formed body
// (anti-enumeration + idempotent) — the server only creates/notifies for a valid
// gated match and silently no-ops otherwise. We surface a generic failure only on
// a network error or a non-2xx (e.g. 429 rate-limit / 400 bad body).
export async function sendJoinRequestClient(
  contact: { email?: string; phone?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/setu/join-request/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(contact),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) return { ok: false, error: 'rate-limited' };
      return { ok: false, error: (data as { error?: string })?.error ?? 'unknown' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ── GET /api/setu/join-request ───────────────────────────────────────────────
// Manager session; lists the open (status==='pending') requests for claims.fid.
export type JoinRequestListItem = {
  token: string;
  requesterName?: string;
  requesterEmail: string;
  requesterPhone?: string;
  matchedMid: string;
  createdAt: string;
  status: string;
};

export async function listJoinRequestsClient(): Promise<
  { ok: true; requests: JoinRequestListItem[] } | { ok: false; error: string }
> {
  try {
    const res = await fetch('/api/setu/join-request', { credentials: 'same-origin' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: (data as { error?: string })?.error ?? 'unknown' };
    }
    const data = (await res.json()) as { requests?: JoinRequestListItem[] };
    return { ok: true, requests: data.requests ?? [] };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ── GET /api/setu/join-request/[token] ───────────────────────────────────────
// Manager-only; metadata for the emailed approve page. Must belong to claims.fid.
export type JoinRequestMetadata = {
  token: string;
  requesterName?: string;
  requesterEmail: string;
  familyName: string;
  status: string;
  expiresAt: string;
};

export async function getJoinRequestClient(
  token: string,
): Promise<JoinRequestMetadata | { error: 'expired' | 'not-found' | 'forbidden' | 'wrong-family' }> {
  try {
    const res = await fetch(`/api/setu/join-request/${encodeURIComponent(token)}`, {
      credentials: 'same-origin',
    });
    if (res.status === 410) return { error: 'expired' };
    if (res.status === 401 || res.status === 403) return { error: 'forbidden' };
    if (!res.ok) {
      // The route returns 404 {error:'wrong-family'} when a signed-in manager
      // opens another family's request — surface it as a distinct "wrong
      // account" state rather than the generic not-found.
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { error: body?.error === 'wrong-family' ? 'wrong-family' : 'not-found' };
    }
    return (await res.json()) as JoinRequestMetadata;
  } catch {
    return { error: 'not-found' };
  }
}

// ── POST /api/setu/join-request/approve | decline ────────────────────────────
// Manager-only + claims.fid === request.fid. Both take { token }.
export async function approveJoinRequestClient(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return postTokenAction('approve', token);
}

export async function declineJoinRequestClient(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return postTokenAction('decline', token);
}

async function postTokenAction(
  action: 'approve' | 'decline',
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/setu/join-request/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: (data as { error?: string })?.error ?? 'unknown' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}
