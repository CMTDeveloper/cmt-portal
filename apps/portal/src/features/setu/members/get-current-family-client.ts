import type { FamilyWithMembers } from './get-current-family';

// Client-safe wrapper around the GET /api/setu/family route.
// The server-side `getCurrentFamily` uses next/headers + firebase-admin, both
// of which crash in a 'use client' component. Pages that need this data in a
// client component should call `getCurrentFamilyClient()` instead.
export async function getCurrentFamilyClient(): Promise<FamilyWithMembers | null> {
  const res = await fetch('/api/setu/family', { credentials: 'same-origin' });
  if (!res.ok) return null;
  return (await res.json()) as FamilyWithMembers;
}
