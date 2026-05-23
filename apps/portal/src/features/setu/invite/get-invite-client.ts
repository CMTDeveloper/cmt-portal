export type InviteMetadata = {
  familyName: string;
  inviterName: string;
  relation: string;
  expiresAt: string;
};

export async function getInviteClient(
  token: string,
): Promise<InviteMetadata | { error: 'expired' | 'accepted' | 'not-found' }> {
  const res = await fetch(`/api/setu/invite/${encodeURIComponent(token)}`, {
    credentials: 'same-origin',
  });
  if (res.status === 410) return { error: 'expired' };
  if (res.status === 409) return { error: 'accepted' };
  if (!res.ok) return { error: 'not-found' };
  return (await res.json()) as InviteMetadata;
}
