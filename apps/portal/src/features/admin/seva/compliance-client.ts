// Client-safe wrapper around the welcome compliance route. The route handler
// uses firebase-admin (server-only); call THIS from the UI and mock THIS in
// component tests. Mirrors features/admin/seva/roster-client.ts.

export interface ComplianceRow {
  fid: string;
  name: string;
  hoursEarned: number;
  met: boolean;
}

export interface SevaComplianceData {
  currentSevaYear: string | null;
  hoursPerYear: number;
  rows: ComplianceRow[];
  summary: { totalFamilies: number; metCount: number; shortCount: number };
}

/** GET the seva compliance report. Returns null on error. */
export async function fetchCompliance(): Promise<SevaComplianceData | null> {
  const res = await fetch('/api/welcome/seva/compliance', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as SevaComplianceData | null;
}
