'use client';
import {
  RolloverReportSchema,
  SchoolYearConfigSchema,
  StartYearResultSchema,
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
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
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
