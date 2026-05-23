export async function acceptInviteClient(
  token: string,
): Promise<{ ok: true; fid: string; mid: string } | { ok: false; error: string }> {
  const res = await fetch('/api/setu/invite/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (data as { error?: string })?.error ?? 'unknown' };
  return { ok: true, fid: (data as { fid: string }).fid, mid: (data as { mid: string }).mid };
}
