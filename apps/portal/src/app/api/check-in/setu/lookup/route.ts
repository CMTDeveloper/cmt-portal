import { NextResponse } from 'next/server';
import type { Family, Student } from '@cmt/shared-domain/check-in';
import { BALA_VIHAR, gradeLabel } from '@cmt/shared-domain';
import { flags } from '@/lib/flags';
import { resolveKioskFamilyOrMigrate } from '@/features/setu/check-in/resolve-kiosk-family';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { getOpenOfferingsForFamily } from '@/features/setu/enrollment/get-open-offerings';
import {
  fetchEnabledLevelsForPid,
  matchChildLevel,
} from '@/features/setu/enrollment/derive-child-level';

/**
 * Authenticated Setu kiosk lookup (step 1 of the two-step kiosk flow).
 * Middleware (`canAccessRoute`) gates this path to the `kiosk` role (admin
 * inherits) BEFORE the handler runs, so the handler trusts that gate and only
 * re-checks the feature flag.
 *
 * Resolves the number a family/sevak enters (a new publicFid or the legacy
 * check-in id) to a Setu family, then reads that family's members (reusing the
 * existing `getFamilyByFid` reader - a single family's `members` subcollection,
 * NOT a per-family fan-out) and returns them in the SAME `Family` shape the
 * legacy `GET /api/check-in/families/{id}` returns, so the existing
 * `KioskCheckInPanel` renders it unchanged. Task 6b (submit) reuses
 * `POST /api/check-in/setu/check-in` (Task 5).
 */
export async function GET(req: Request) {
  if (!flags.checkInKiosk) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const id = new URL(req.url).searchParams.get('id')?.trim() ?? '';
  if (!id) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const resolved = await resolveKioskFamilyOrMigrate(id);
  if (!resolved) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  // resolveKioskFamily already confirmed the family doc exists; a null here is a
  // race (deleted between reads) - treat it as not-found rather than 500.
  const data = await getFamilyByFid(resolved.fid);
  if (!data) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  // Derive each child's Bala Vihar LEVEL (e.g. "Level 6") so the panel shows the
  // level - not the raw grade number ("6") - alongside the grade for verification.
  // Reuses the SAME open-offering + level match the family dashboard and teacher
  // roster use, so the kiosk places a child in the exact level they'd see there.
  // Off-season (no open offering) leaves `levels` empty → children fall back to a
  // friendly grade label ("Grade 6"), still an improvement over the bare number.
  const offerings = await getOpenOfferingsForFamily(BALA_VIHAR, resolved.location);
  const oid = offerings[0]?.oid;
  const levels = oid ? await fetchEnabledLevelsForPid(oid) : [];
  const now = new Date();

  // The kiosk checks in the WHOLE family: a family arrives together and a sevak
  // checks off who actually came. So every member - adults AND children -
  // appears, matching the legacy family-check-in app. Adults are flagged so the
  // panel labels them "Adult" and carry no school level; children show their
  // level + grade.
  const displayFid = resolved.publicFid ?? resolved.legacyFid ?? resolved.fid;
  const students: Student[] = data.members.map((m) => {
    const isAdult = m.type === 'Adult';
    if (isAdult) {
      return {
        sid: m.mid,
        fid: displayFid,
        firstName: m.firstName,
        lastName: m.lastName,
        level: '',
        isAdult: true,
      };
    }
    const grade = gradeLabel(m.schoolGrade ?? null);
    const matched = matchChildLevel(
      {
        type: m.type,
        schoolGrade: m.schoolGrade ?? null,
        birthMonthYear: m.birthMonthYear ?? null,
      },
      levels,
      now,
    );
    // Prefer the level name; when no enabled level matches (off-season, or a
    // grade outside every band) fall back to the friendly grade so the label is
    // never blank or a bare number.
    const level = matched?.levelName ?? grade;
    return {
      sid: m.mid,
      fid: displayFid,
      firstName: m.firstName,
      lastName: m.lastName,
      level,
      ...(grade ? { grade } : {}),
      isAdult: false,
    };
  });

  const family: Family = {
    // `fid` must be a value Task-5's resolveKioskFamily can re-resolve for the
    // submit step (publicFid preferred, then legacy id), NOT the CMT- doc id -
    // resolveKioskFamily looks up publicFid/legacyFid only, never the doc id.
    fid: displayFid,
    name: resolved.name,
    // The kiosk panel renders neither contacts nor paymentStatus; supply the
    // Family type's required fields with neutral values ('partial' = the legacy
    // "unknown/missing" convention) rather than an extra Firestore read.
    contacts: [],
    paymentStatus: 'partial',
    students,
  };

  return NextResponse.json(family, { status: 200 });
}
