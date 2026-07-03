import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { flags } from '@/lib/flags';
import { getSessionFamily } from '@/features/setu/members/get-session-family';
import { loadFamilyDashboard } from '@/app/family/_helpers/load-dashboard';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';

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

  const { model, upcoming, seva, prasad, bvChildren, familyCounts } = await loadFamilyDashboard(
    fam.family,
    fam.members,
  );
  const schoolYear = await getLiveSchoolYearCached();

  // Slice 2: mobile gate signal. Only meaningful for a manager (per-family
  // acceptance). Fail-soft — a config hiccup must never 500 the mobile home.
  let disclaimersPending = false;
  if (flags.setuDisclaimers && fam.isManager) {
    try {
      const st = await getDisclaimerStateForFamily(portalFirestore(), fam.family);
      disclaimersPending = !st.accepted;
    } catch {
      disclaimersPending = false;
    }
  }

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
        // Child/adult split for the mobile Family block (Task 5). Additive.
        counts: familyCounts,
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
        // One row per BV-enrolled child (Task 5): level name, assigned teacher
        // name(s), and Sunday attendance ratio. Already plain-serializable
        // ({ mid, firstName, levelName: string|null, teacherNames: string[],
        // attendance: { present, total } }). Empty when no active BV enrollment.
        children: bvChildren,
      },
      otherPrograms: model.otherProgramCards,
      // Forward-compatible action seam. ALWAYS empty in Slice 1 — the Bala Vihar
      // donation is surfaced via the balaVihar donation fields, NOT as an action
      // item (owner decision 2026-07-03 / df319d2). Slice 2 populates it (e.g. a
      // disclaimers item). The client builds its own navigation from `kind`.
      actionItems: model.actionItems,
      // Slice 2: true when this (manager) family must accept the current
      // disclaimers before using the portal. Web enforces this via a redirect
      // gate; mobile decides its own gating. Always false when the flag is off,
      // for a family-member, or on a read error.
      disclaimersPending,
      upcoming,
      seva,
      prasad,
    },
    { status: 200 },
  );
}
