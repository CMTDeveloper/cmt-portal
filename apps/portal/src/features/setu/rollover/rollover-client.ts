'use client';
import {
  CalendarCopyResultSchema,
  RolloverReportSchema,
  SchoolYearConfigSchema,
  StartYearResultSchema,
  type CalendarCopyResult,
  type RolloverReport,
  type SchoolYearConfig,
  type StartYearResult,
} from '@cmt/shared-domain';

async function sendJson(url: string, body: unknown, method = 'POST'): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code: string | undefined;
    try { code = (await res.json())?.error; } catch { /* non-JSON body */ }
    const err = new Error(`${url} → ${res.status}${code ? ` (${code})` : ''}`) as Error & { code?: string | undefined; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Clone this year's levels + offerings into next year (Step 1). */
export async function startNewYearClient(): Promise<StartYearResult> {
  return StartYearResultSchema.parse(await sendJson('/api/admin/school-year/start', {}));
}

/** Persist the admin-managed current school year. */
export async function saveSchoolYearConfigClient(currentYear: string): Promise<SchoolYearConfig> {
  const payload = await sendJson('/api/admin/school-year', { currentYear }, 'PUT');
  const data = payload as { config?: unknown };
  return SchoolYearConfigSchema.parse(data.config);
}

/** Dry-run the promotion (Step 2 preview) — no writes. */
export async function previewPromotionClient(): Promise<RolloverReport> {
  return RolloverReportSchema.parse(await sendJson('/api/admin/school-year/promote', { dryRun: true }));
}

/** Commit the promotion (Step 2 confirm). */
export async function commitPromotionClient(): Promise<RolloverReport> {
  return RolloverReportSchema.parse(await sendJson('/api/admin/school-year/promote', { dryRun: false }));
}

/** Activate next year (flip live year + align seva). Throws Error with .code='promotion-not-run' on the 409 gate. */
export async function activateSchoolYearClient(): Promise<SchoolYearConfig> {
  const payload = await sendJson('/api/admin/school-year/activate', {});
  return SchoolYearConfigSchema.parse((payload as { config: unknown }).config);
}

/** Copy this year's class calendar into next year (Year-center Step 3 helper). */
export async function copyCalendarFromLastYearClient(): Promise<CalendarCopyResult> {
  return CalendarCopyResultSchema.parse(await sendJson('/api/admin/school-year/copy-calendar', {}));
}
