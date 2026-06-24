import type {
  EnrollmentReport,
  AttendanceReport,
  DonationsReport,
} from '@cmt/shared-domain';

// Maps each report kind to its response shape so `fetchReport` is fully typed
// at the call site (the hub knows exactly what it gets back per card).
interface ReportByKind {
  enrollment: EnrollmentReport;
  attendance: AttendanceReport;
  donations: DonationsReport;
}
export type ReportKindKey = keyof ReportByKind;

// Only the params the hub UI actually sends. `from`/`to` are attendance-only;
// `program` is accepted by the API for power users but the hub doesn't render a
// program selector in v1.
export interface FetchReportParams {
  from?: string;
  to?: string;
  program?: string;
  year?: string;
}

/**
 * Fetches a report's JSON summary. Mirrors `roster-client.ts`: it throws on a
 * non-OK response so each card's own try/catch can surface an inline error and
 * fail independently — a single card error must never blank the hub.
 *
 * Conditional spreads (never assigning `undefined`) keep this clean under
 * `exactOptionalPropertyTypes`.
 */
export async function fetchReport<K extends ReportKindKey>(
  kind: K,
  params: FetchReportParams = {},
): Promise<ReportByKind[K]> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.program) qs.set('program', params.program);
  if (params.year) qs.set('year', params.year);
  const query = qs.toString();
  const res = await fetch(`/api/welcome/reports/${kind}${query ? `?${query}` : ''}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`report-${kind}-failed-${res.status}`);
  return (await res.json()) as ReportByKind[K];
}
