import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { getSessionFamily } from '@/features/setu/members/get-session-family';
import { loadFamilyDashboard } from '@/app/family/_helpers/load-dashboard';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';

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
  const schoolYear = await getLiveSchoolYearCached();

  return NextResponse.json(
    {
      schoolYear,
      // publicFid (4-digit) is exposed at family level alongside the join-key
      // `fid` (issue #4). It's additive + nullable — null until the renumber
      // migration assigns one; the mobile client does its own `publicFid ?? fid`
      // fallback and never uses publicFid as a join key / route param.
      family: {
        fid: fam.family.fid,
        publicFid: fam.family.publicFid ?? null,
        name: fam.family.name,
        location: fam.family.location,
      },
      currentMid: fam.currentMid,
      isManager: fam.isManager,
      members: fam.members.map((m) => ({
        mid: m.mid,
        // publicMid (5-digit) rides alongside the join-key `mid` (same additive +
        // nullable + non-join-key rules as publicFid). The mobile client shows it
        // on the member-detail screen.
        publicMid: m.publicMid ?? null,
        firstName: m.firstName,
        lastName: m.lastName,
        type: m.type,
      })),
      balaVihar: {
        isEnrolled: model.isEnrolled,
        // Three-state engagement flag (issue #23): 'enrolled' = engaged this year
        // (attended a BV class or completed a donation / legacy-paid), 'registered'
        // = active BV enrollment but no engagement yet, 'none' = no active BV
        // enrollment. `isEnrolled` is NOT re-derived from this — it keeps its
        // doc-exists semantics.
        bvState: model.bvState,
        kidsEnrolled: model.kidsEnrolled,
        termLabel: model.enrollPeriodLabel,
        suggestedAmount: model.suggestedAmount,
        givenForPeriod: model.givenForPeriod,
        donationComplete: model.donation.complete,
        donationPct: model.donation.pct,
        donationHeading: model.donation.heading,
        isLegacyPeriod: model.isLegacyPeriod,
        legacyPaid: model.legacyPaid,
      },
      otherPrograms: model.otherProgramCards,
      upcoming,
      seva,
      prasad,
    },
    { status: 200 },
  );
}
