import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { SchoolYearConfigSchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import {
  getSchoolYearConfig,
  setSchoolYearConfig,
} from '@/features/setu/rollover/school-year-config';
import { deriveNextSchoolYear } from '@/features/setu/rollover/school-year';
import { computeYearReadiness } from '@/features/setu/rollover/year-readiness';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = portalFirestore();
  const config = await getSchoolYearConfig(db);
  const toYear = deriveNextSchoolYear(config.currentYear);
  const readiness = await computeYearReadiness(db, { fromYear: config.currentYear, toYear });
  return NextResponse.json({ config, nextYear: toYear, readiness });
}

export async function PUT(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = SchoolYearConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const config = await setSchoolYearConfig(
    portalFirestore(),
    parsed.data,
    session.mid ?? session.uid ?? 'unknown',
  );
  revalidatePath('/admin/school-year');
  return NextResponse.json({ config, nextYear: deriveNextSchoolYear(config.currentYear) });
}
