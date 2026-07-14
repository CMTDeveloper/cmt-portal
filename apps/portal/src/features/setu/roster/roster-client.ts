import type { RosterReportResponse, MigrationStatusResponse } from '@cmt/shared-domain/setu';

// The roster report loads the full family dataset once; the browser then filters,
// counts, and paginates in memory (see roster-browser.tsx). Free-text search is a
// separate path (searchFamiliesClient), unchanged.
export async function fetchRosterReportClient(year?: string): Promise<RosterReportResponse> {
  const qs = new URLSearchParams();
  if (year) qs.set('year', year);
  const res = await fetch(`/api/welcome/roster/report?${qs.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`roster-report-failed-${res.status}`);
  return (await res.json()) as RosterReportResponse;
}

export async function fetchMigrationStatusClient(): Promise<MigrationStatusResponse> {
  const res = await fetch('/api/welcome/families/migration-status', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`migration-status-failed-${res.status}`);
  return (await res.json()) as MigrationStatusResponse;
}
