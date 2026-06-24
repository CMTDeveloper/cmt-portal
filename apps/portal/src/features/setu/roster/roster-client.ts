import type { RosterListResponse, RosterQuery, MigrationStatusResponse } from '@cmt/shared-domain/setu';

// Free-text search is NOT a roster query param (see RosterQuerySchema) — the
// roster screen calls the welcome-team search endpoint directly when the search
// box is non-empty. So we only forward location / program / cursor / limit here.
export async function fetchRosterClient(params: Partial<RosterQuery>): Promise<RosterListResponse> {
  const qs = new URLSearchParams();
  if (params.location) qs.set('location', params.location);
  if (params.program) qs.set('program', params.program);
  if (params.year) qs.set('year', params.year);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  const res = await fetch(`/api/welcome/families?${qs.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`roster-failed-${res.status}`);
  return (await res.json()) as RosterListResponse;
}

export async function fetchMigrationStatusClient(): Promise<MigrationStatusResponse> {
  const res = await fetch('/api/welcome/families/migration-status', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`migration-status-failed-${res.status}`);
  return (await res.json()) as MigrationStatusResponse;
}
