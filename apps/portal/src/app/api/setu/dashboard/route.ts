import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { getSessionFamily } from '@/features/setu/members/get-session-family';
import { loadFamilyDashboard } from '@/app/family/_helpers/load-dashboard';

/**
 * GET /api/setu/dashboard — the family home aggregate for mobile (and any
 * non-server-component client). Mirrors what the /family server page renders,
 * via the shared loadFamilyDashboard() composition. Header-based session so
 * Bearer (mobile) callers work. UI-only fields (CSS-var pill colors, donateUrl)
 * are intentionally omitted; the client builds its own presentation.
 */
export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const fam = await getSessionFamily(req);
  if (!fam) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const { model, upcoming, seva, prasad } = await loadFamilyDashboard(fam.family, fam.members);

  return NextResponse.json(
    {
      family: { fid: fam.family.fid, name: fam.family.name, location: fam.family.location },
      currentMid: fam.currentMid,
      isManager: fam.isManager,
      members: fam.members.map((m) => ({
        mid: m.mid,
        firstName: m.firstName,
        lastName: m.lastName,
        type: m.type,
      })),
      balaVihar: {
        isEnrolled: model.isEnrolled,
        kidsEnrolled: model.kidsEnrolled,
        termLabel: model.enrollPeriodLabel,
        suggestedAmount: model.suggestedAmount,
        givenForPeriod: model.givenForPeriod,
        donationComplete: model.donation.complete,
        donationPct: model.donation.pct,
        donationHeading: model.donation.heading,
        isLegacyPeriod: model.isLegacyPeriod,
        legacyPaid: model.legacyPaid,
        attendance: {
          attended: model.attendance.summary.attended,
          total: model.attendance.total,
          pct: model.attendance.pct,
          hasAttendance: model.attendance.hasAttendance,
          marks: model.attendance.summary.marks,
        },
      },
      otherPrograms: model.otherProgramCards,
      upcoming,
      seva,
      prasad,
    },
    { status: 200 },
  );
}
