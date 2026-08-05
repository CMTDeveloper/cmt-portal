import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getFamilyForWelcome } from '@/features/setu/search/get-family-for-welcome';
import { getFamilySevaProgress, type FamilySevaProgress } from '@/features/setu/seva/get-family-seva-progress';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, isAdmin, BALA_VIHAR, recordedAllergy, isParticipating, inactiveLabelFor, type WithRole } from '@cmt/shared-domain';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { adultStudyClassProgramKeys } from '@/features/setu/adult-class/program-keys';
import { deriveFamilyPayment } from '@/features/setu/roster/payment';
import { getOpenOfferingsForFamily, resolveCurrentOffering } from '@/features/setu/enrollment/get-open-offerings';
import { resolveSuggestedAmount } from '@cmt/shared-domain';
import {
  AdminEnrollControl,
  type AdminEnrollOffering,
} from '@/features/setu/enrollment/components/admin-enroll-control';
import {
  PaymentOverrideControl,
  type PaymentOverrideEnrollment,
} from '@/features/setu/enrollment/components/payment-override-control';
import { displayFid } from '@cmt/shared-domain/setu';
import type { FamilyDoc, MemberDoc } from '@cmt/shared-domain/setu';
import { cookies } from 'next/headers';

export default function WelcomeFamilyDetailPage({
  params,
}: {
  params: Promise<{ fid: string }>;
}) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading family…</div>}>
      <WelcomeFamilyDetailBody params={params}/>
    </Suspense>
  );
}

// Exported for testing — the page's default export is a thin Suspense wrapper
// (Next.js 16 Cache Components require dynamic data access inside <Suspense>).
export async function WelcomeFamilyDetailBody({
  params,
}: {
  params: Promise<{ fid: string }>;
}) {
  // Defensive role check — middleware enforces this but the Server Component
  // re-verifies (defense in depth). Any failure mode (no cookie, invalid
  // cookie, wrong role) falls through to AccessDenied — we do NOT read family
  // data until welcome-team is positively confirmed.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  // isWelcomeTeam() helper handles multi-role: admin inherits welcome-team,
  // and a family-manager with extraRoles=['welcome-team'] also passes.
  let allowed = false;
  // Tracked separately from `allowed`: this page admits welcome-team AND
  // coordinator (both need to read a family), but the payment override is
  // admin-only. Deriving one from the other is exactly how a money control
  // leaks to a role that was never granted it.
  let admin = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie);
    // Coordinator reaches this page too: every /welcome/roster row links here,
    // so without it the one screen the role is granted dead-ends on click.
    // Spec 3.1 excludes family EDIT from coordinator, not family READ.
    // isCoordinator dropped: isWelcomeTeam() covers it since 2026-08-05, and
    // naming it again would suggest coordinator needs per-route mention.
    if (raw && isWelcomeTeam(raw as unknown as WithRole)) {
      allowed = true;
      admin = isAdmin(raw as unknown as WithRole);
    }
  }
  if (!allowed) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
      </div>
    );
  }

  const { fid } = await params;
  const data = await getFamilyForWelcome(fid);

  if (!data) notFound();

  const sevaProgress = await getFamilySevaProgress(fid);

  // ADMIN ONLY, and not loaded at all otherwise - a coordinator viewing this
  // page pays no extra read for a control they will never be shown.
  // Fail-soft: the override is a staff convenience, and losing it must not cost
  // the family detail a coordinator actually came here for.
  // Which programs ARE the adult class is data, not a key - each centre may run
  // its own (Scarborough's is `adult-study-east`). Read once here and passed
  // down, because the control is a client component and cannot ask. Resolving it
  // with a literal key comparison inside the control is what mislabelled a
  // Scarborough family's genuine waiver as "no reason recorded" and offered to
  // record a payment they never made (reported on FID 5010, 2026-08-04).
  // `listPrograms()` behind this is `use cache`d on the 'programs' tag.
  //
  // Deliberately INSIDE the try, not `.catch(() => [])`: an empty list would
  // make every waived enrollment look like an unexplained zero and put the
  // "Mark paid off-portal" button back on it - i.e. a transient read failure
  // would fail OPEN, into exactly the false money record this fixes. Losing the
  // whole panel for one render is the cheaper failure.
  //
  // The payment verdict joins the SAME promise: a family whose money already
  // arrived must not be offered "Mark paid off-portal".
  //
  // `deriveFamilyPayment` rather than calling `classifyRosterPayment` here -
  // the route's guard calls the SAME function, so the screen and the rule that
  // stops the write are ONE predicate rather than two that must be kept in
  // step. The first draft of this inlined the classifier and consequently
  // missed live monthly pledges, which write no completed donations and would
  // have read as unpaid on this page while the roster read Paid. It never
  // throws (returns 'unknown'), so it cannot be what collapses the panel.
  const overridable: PaymentOverrideEnrollment[] = admin
    ? await Promise.all([getEnrollments(fid), adultStudyClassProgramKeys(), deriveFamilyPayment(fid)])
        .then(([rows, adultClassKeys, verdict]) => {
          const active = rows.filter((e) => e.status === 'active');
          // Family-level, and every row receives the same answer: donations are
          // recorded against the family, and a live pledge is a family-level
          // arrangement. Only a POSITIVE 'paid' suppresses - 'unknown' leaves
          // the action available, because this route is the only way to record
          // a genuine off-portal arrangement.
          const familyHasPaid = verdict === 'paid';
          return active
            .map((e) => ({
              familyHasPaid,
              isAdultClass: adultClassKeys.includes(e.programKey),
              eid: e.eid,
              programKey: e.programKey,
              programLabel: e.programLabel,
              termLabel: e.termLabel,
              effectiveSuggestedAmount: e.effectiveSuggestedAmount,
              suggestedAmountOverride: e.suggestedAmountOverride ?? null,
              // Absent on every enrollment written before 2026-08-04, so `=== true`
              // rather than a truthiness check. Omitting it here is what let the
              // control keep reading a bare `0` as "settled" after the rest of the
              // app had stopped - a hand-mapped projection dropping a new field,
              // silently, because the object is built by listing fields.
              settledOffPortal: e.settledOffPortal === true,
            }));
        })
        .catch((err) => {
          console.error('[welcome-family] could not read enrollments for the override control', err);
          return [];
        })
    : [];

  // The Bala Vihar offering this family could be enrolled INTO, when they are
  // not already. Admin-only and only when needed, so no family that is already
  // enrolled pays for the offerings read.
  //
  // `resolveCurrentOffering` rather than `[0]`: it picks the family's own
  // centre and breaks ties the same way the family's enroll page does, so the
  // admin cannot enrol them into a different centre's class than the one they
  // would have joined themselves.
  const hasActiveBv = overridable.some((e) => e.programKey === BALA_VIHAR);
  let joinableBv: AdminEnrollOffering | null = null;
  if (admin && !hasActiveBv) {
    try {
      const offerings = await getOpenOfferingsForFamily(BALA_VIHAR, data.family.location);
      const chosen = resolveCurrentOffering(offerings, data.family.location);
      if (chosen) {
        joinableBv = {
          oid: chosen.oid,
          programLabel: chosen.programLabel,
          termLabel: chosen.termLabel,
          suggestedAmount: resolveSuggestedAmount(chosen, new Date()),
        };
      }
    } catch (err) {
      // Fail-soft, like the enrollments read above: an admin convenience must
      // not cost the family detail a coordinator came here for.
      console.error('[welcome-family] could not resolve a joinable Bala Vihar offering', err);
    }
  }

  const { family, members } = data;
  const adults = members.filter((m) => m.type !== 'Child');
  const children = members.filter((m) => m.type === 'Child');

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/welcome" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Family detail</span>
              <div style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 90px' }}>
              <FamilyDetailBody family={family} members={members} adults={adults} children={children} sevaProgress={sevaProgress} overridable={overridable} canOverride={admin} joinableBv={joinableBv} fid={fid}/>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 24 }}>
          <Link href="/welcome" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
            <SetuIcon.back/> Back to search
          </Link>
          <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
            FID {displayFid(family)}{family.legacyFid ? ` · Legacy ${family.legacyFid}` : ''}
          </p>
          <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>The {family.name} Family</h1>
        </header>
        <FamilyDetailBody family={family} members={members} adults={adults} children={children} sevaProgress={sevaProgress} overridable={overridable} canOverride={admin} joinableBv={joinableBv} fid={fid}/>
      </div>
    </>
  );
}

type FamilyDetailBodyProps = {
  family: FamilyDoc;
  members: MemberDoc[];
  adults: MemberDoc[];
  children: MemberDoc[];
  sevaProgress: FamilySevaProgress;
  /** Empty for non-admins - the control is admin-only and the data is not even read. */
  overridable: PaymentOverrideEnrollment[];
  /**
   * Whether the viewer may override at all. Tracked SEPARATELY from
   * `overridable.length`, which was the first cut and was wrong: an admin
   * looking at a family with no active enrollment saw no Donation section, and
   * therefore could not tell "nothing to mark" from "this feature is missing".
   * That exact confusion was reported on preview within an hour of shipping.
   */
  canOverride: boolean;
  /** The Bala Vihar offering an admin could enrol this family into, if any. */
  joinableBv: AdminEnrollOffering | null;
  fid: string;
};

function FamilyDetailBody({ family, members, adults, children, sevaProgress, overridable, canOverride, joinableBv, fid }: FamilyDetailBodyProps) {
  const sevaMet = sevaProgress.hoursEarned >= sevaProgress.hoursPerYear;

  return (
    <div>
      {/* Family header card */}
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Family</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>{family.name}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>Location: {family.location}</span>
          <span>FID: {displayFid(family)}</span>
          {family.legacyFid && <span>Legacy FID: {family.legacyFid}</span>}
          <span>Members: {members.length}</span>
          <span>Since: {family.createdAt.getFullYear()}</span>
        </div>
      </div>

      {/* ── Donation, for ADMINS only ──────────────────────────────────────────
          `overridable` is empty for every other role - the page does not even
          read the enrollments - so this section cannot render for a coordinator
          or a welcome-team volunteer. The route enforces the same rule again;
          this is the page-level half of the repo's three-gate requirement. */}
      {canOverride && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            Donation
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 4px' }}>
            Use this when a family&apos;s donation is already collected outside the portal - an
            existing pre-authorized debit, or a payment handled by the office.
          </p>
          {overridable.length === 0 ? (
            joinableBv ? (
              <AdminEnrollControl fid={fid} offering={joinableBv} />
            ) : (
              <div className="card" style={{ padding: 16, marginTop: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, margin: 0 }}>
                  This family has no active enrollment, and there is no open Bala Vihar offering
                  for their centre to enrol them into.
                </p>
              </div>
            )
          ) : (
            <>
              {overridable.map((e) => (
                <PaymentOverrideControl key={e.eid} enrollment={e} />
              ))}
              {/* ── Say WHY Bala Vihar is absent ───────────────────────────────
                  Reported on preview within an hour of shipping: an admin
                  looked at a family with an Adult Study Class enrollment and a
                  child who had been ADDED but never ENROLLED, saw only Adult
                  Study Class, and could not tell whether Bala Vihar was missing
                  because the family was not enrolled or because the feature was
                  broken. Listing only what exists is correct; leaving the
                  absence unexplained is not. */}
              {!overridable.some((e) => e.programKey === BALA_VIHAR) &&
                (joinableBv ? (
                  <AdminEnrollControl fid={fid} offering={joinableBv} />
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '10px 0 0' }}>
                    No active Bala Vihar enrollment, and no open Bala Vihar offering for this
                    family&apos;s centre to enrol them into.
                  </p>
                ))}
            </>
          )}
        </div>
      )}

      {/* Seva hours card — omitted entirely when no current seva year is set */}
      {sevaProgress.currentSevaYear && (
        <div className="card" style={{ padding: 18, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Seva hours</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {sevaProgress.hoursEarned} of {sevaProgress.hoursPerYear} hrs
              <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {sevaProgress.currentSevaYear}</span>
            </div>
          </div>
          <span
            style={
              sevaMet
                ? { flex: '0 0 auto', fontSize: 10, padding: '2px 9px', borderRadius: 99, fontWeight: 600, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }
                : { flex: '0 0 auto', fontSize: 10, padding: '2px 9px', borderRadius: 99, fontWeight: 600, background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }
            }
          >
            {sevaMet ? 'Met' : 'Short'}
          </span>
        </div>
      )}

      {/* Adults */}
      {adults.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Adults · {adults.length}</div>
          <div className="col" style={{ gap: 8 }}>
            {adults.map((m) => (
              <MemberRow key={m.mid} m={m} fid={family.fid}/>
            ))}
          </div>
        </div>
      )}

      {/* Children */}
      {children.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Children · {children.length}</div>
          <div className="col" style={{ gap: 8 }}>
            {children.map((m) => (
              <MemberRow key={m.mid} m={m} fid={family.fid}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MemberRow({ m, fid }: { m: MemberDoc; fid: string }) {
  const name = `${m.firstName} ${m.lastName}`;
  const typeLabel = m.type === 'Child'
    ? `Child${m.schoolGrade ? ` · ${m.schoolGrade}` : ''}`
    : 'Adult';

  // A member who no longer takes part. Without this the row is identical to an
  // active one, so a child with no school grade reads as an incomplete record
  // to chase - reported by Vaibhav on 2026-08-05, on a family whose record was
  // in fact correct. The grade requirement is deliberately waived for an
  // inactive member (`membersRequiringCompletion`), so the absent grade is the
  // EXPECTED state here and the row has to say why.
  //
  // Same two labels as the family's own view (`memberStatusChip`), and the same
  // distinction: a family that marked someone as finished gets plain language,
  // while a member the legacy migration retired on their behalf is told where
  // that came from, because it is a guess we made and might have got wrong.
  const inactive = !isParticipating(m);
  const inactiveLabel = inactiveLabelFor(m);

  return (
    <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <SetuAvatar name={name} size={44}/>
      <div style={{ flex: 1 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
          {m.manager && <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>Manager</span>}
          {inactive && (
            <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--surface2)', color: 'var(--muted)', borderRadius: 99, fontWeight: 600 }}>
              {inactiveLabel}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{typeLabel}</div>
        {m.email && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{m.email}</div>}
        {m.phone && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{m.phone}</div>}
        {/* Only a REAL allergy earns the red row. The "No known allergies"
            answer stores the literal 'None', which used to render here as a
            red ⚠ None - reported by Vaibhav 2026-08-05. Staff need the
            exception, not the answer. */}
        {recordedAllergy(m.foodAllergies) && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--err)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <SetuIcon.warn/> {recordedAllergy(m.foodAllergies)}
          </div>
        )}
        <Link href={`/welcome/family/${fid}/members/${m.mid}`} style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
          View profile
        </Link>
      </div>
    </div>
  );
}
