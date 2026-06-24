'use client';
import { z } from 'zod';
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

// --- Step 3 optional copy helpers (prasad / teachers / seva) ---
// Inline, admin-only Zod (these routes aren't part of the mobile contract, so
// they deliberately don't live in @cmt/shared-domain).
const PrasadCopyResultSchema = z.object({ fromYear: z.string(), toYear: z.string(), created: z.array(z.string()), existing: z.array(z.string()) });
const TeacherPrefillResultSchema = z.object({ fromYear: z.string(), toYear: z.string(), filled: z.array(z.string()), skipped: z.array(z.string()) });
const SevaCopyResultSchema = z.object({ fromYear: z.string(), toYear: z.string(), created: z.array(z.string()), existing: z.array(z.string()) });
const SevaCandidateSchema = z.object({ oppId: z.string(), title: z.string(), date: z.string(), location: z.string().optional(), status: z.string() });

export type PrasadCopyResultC = z.infer<typeof PrasadCopyResultSchema>;
export type TeacherPrefillResultC = z.infer<typeof TeacherPrefillResultSchema>;
export type SevaCopyResultC = z.infer<typeof SevaCopyResultSchema>;
export type SevaCandidateC = z.infer<typeof SevaCandidateSchema>;

/** Copy this year's prasad assignments into next year (Step 3, opt-in). */
export async function copyPrasadFromLastYearClient(): Promise<PrasadCopyResultC> {
  return PrasadCopyResultSchema.parse(await sendJson('/api/admin/school-year/copy-prasad', {}));
}

/** Pre-fill next year's teachers from this year (Step 3, opt-in). */
export async function copyTeachersFromLastYearClient(): Promise<TeacherPrefillResultC> {
  return TeacherPrefillResultSchema.parse(await sendJson('/api/admin/school-year/copy-teachers', {}));
}

/** Copy selected seva opportunities into next year (Step 3, opt-in). */
export async function copySevaFromLastYearClient(oppIds: string[], decideLater: boolean): Promise<SevaCopyResultC> {
  return SevaCopyResultSchema.parse(await sendJson('/api/admin/school-year/copy-seva', { oppIds, decideLater }));
}

/** Last year's seva opportunities, for the copy picker. Uses the welcome GET (admin passes its welcome-team gate). */
export async function listSevaCandidatesClient(sevaYear: string): Promise<SevaCandidateC[]> {
  const res = await fetch(`/api/welcome/seva/opportunities?sevaYear=${encodeURIComponent(sevaYear)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`seva-candidates-${res.status}`);
  const json = await res.json();
  return z.array(SevaCandidateSchema).parse((json as { opportunities?: unknown }).opportunities ?? []);
}
