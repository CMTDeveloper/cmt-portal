import { NextResponse } from 'next/server';
import type { Family, Student } from '@cmt/shared-domain/check-in';
import { flags } from '@/lib/flags';
import { resolveKioskFamily } from '@/features/setu/check-in/resolve-kiosk-family';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';

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

  const resolved = await resolveKioskFamily(id);
  if (!resolved) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  // resolveKioskFamily already confirmed the family doc exists; a null here is a
  // race (deleted between reads) - treat it as not-found rather than 500.
  const data = await getFamilyByFid(resolved.fid);
  if (!data) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  // The kiosk checks in students (children). Adults are excluded, mirroring both
  // the legacy roster (parent rows dropped) and the welcome/family detail view
  // (children = members with type 'Child'). `level` reuses the same child label
  // that view derives - the member's schoolGrade.
  const displayFid = resolved.publicFid ?? resolved.legacyFid ?? resolved.fid;
  const students: Student[] = data.members
    .filter((m) => m.type === 'Child')
    .map((m) => ({
      sid: m.mid,
      fid: displayFid,
      firstName: m.firstName,
      lastName: m.lastName,
      level: m.schoolGrade ?? '',
    }));

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
