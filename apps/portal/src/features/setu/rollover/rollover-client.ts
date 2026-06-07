'use client';
import {
  RolloverReportSchema,
  StartYearResultSchema,
  type RolloverReport,
  type StartYearResult,
} from '@cmt/shared-domain';

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

/** Clone this year's levels + offerings into next year (Step 1). */
export async function startNewYearClient(): Promise<StartYearResult> {
  return StartYearResultSchema.parse(await postJson('/api/admin/school-year/start', {}));
}

/** Dry-run the promotion (Step 2 preview) — no writes. */
export async function previewPromotionClient(): Promise<RolloverReport> {
  return RolloverReportSchema.parse(await postJson('/api/admin/school-year/promote', { dryRun: true }));
}

/** Commit the promotion (Step 2 confirm). */
export async function commitPromotionClient(): Promise<RolloverReport> {
  return RolloverReportSchema.parse(await postJson('/api/admin/school-year/promote', { dryRun: false }));
}
