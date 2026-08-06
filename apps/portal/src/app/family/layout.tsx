import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebar, DesktopSidebarLive } from '@/features/family/components/desktop-sidebar';
import { MobileBottomNav } from '@/features/family/components/mobile-bottom-nav';
import { LoadingOm } from '@/components/chrome/loading-om';
import { SchoolYearBadge } from '@/components/chrome/school-year-badge';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, isTeacher, isWelcomeTeam, hasRole, type WithRole } from '@cmt/shared-domain';
import { profileGatePending, earlierGatesPending, getDisclaimerStateCached } from './_helpers/gates';
import { loadAdultClassGateDataFailSoft } from '@/features/setu/adult-class/load-gate-data';
import { needsAdultClassSelection } from '@/features/setu/adult-class/needs-selection';
import { flags } from '@/lib/flags';

// Route the gate redirects an incomplete family to. It lives at a TOP-LEVEL
// route, OUTSIDE this /family layout, on purpose. When the completion screen was
// nested at /family/complete-profile it inherited THIS gate, which then had to
// exempt itself via the current request pathname — and under a soft client-side
// navigation that header is stale (it read '/family' while the layout
// re-rendered for the completion route), so the gate redirected to itself
// forever: a blank page with flickering chrome. Redirecting OUTSIDE /family
// means the gate never re-runs at the destination — no exemption to get wrong,
// nothing to loop.
const COMPLETE_PROFILE_PATH = '/complete-profile';

// Profile-completion gate (owner spec 2026-06-22). Runs on every /family/*
// render. A MANAGER must complete the WHOLE family (children included — they
// don't sign in); a plain family-MEMBER is gated only on their own record
// (canAccessRoute lets a member edit only themselves). The completeness rules
// come from the single shared @cmt/shared-domain helper so the gate, the forms,
// and the write routes all agree.
export async function ProfileCompletionGate() {
  // flags.setuAuth false ⇒ the mock/prototype path with no real session; the
  // dashboard renders its mock family and there's nothing to gate.
  if (!flags.setuAuth) return null;

  const data = await getCurrentFamily();
  if (!data) return null; // unauthenticated — middleware already handles redirect

  // Scope through the shared helper so this gate and the /complete-profile form
  // can never disagree on who blocks whom. A manager is responsible for their own
  // record + non-manager dependents (NOT invited co-managers, who self-complete),
  // plus the required family home address and an unconfirmed migrated centre.
  //
  // The condition list itself lives in profileGatePending() because every gate
  // ordered after this one has to ask the same question, and a per-gate copy is
  // what let P6's centre-confirmation condition be added to one place and missed
  // in another. Add new conditions THERE, not here.
  if (profileGatePending(data)) redirect(COMPLETE_PROFILE_PATH);
  return null;
}

// Disclaimer-acceptance gate (Slice 2). Runs on every /family/* render AFTER the
// profile gate. Per-family: only the MANAGER accepts. Redirects to the top-level
// /disclaimers screen (OUTSIDE this layout, like /complete-profile) when the
// family's acceptance isn't current (stale version or new school year). Flag-gated
// OFF by default. Guards on profile-completeness so the profile gate always runs
// first regardless of Suspense resolution order.
export async function DisclaimerGate() {
  if (!flags.setuDisclaimers) return null;

  const data = await getCurrentFamily();
  if (!data) return null; // unauthenticated — middleware handles it
  if (!data.isManager) return null; // per-family: members aren't gated
  // Defer to ProfileCompletionGate if the profile is still incomplete (missing
  // member fields, the required family home address, OR an unconfirmed centre —
  // all three are profile data collected before disclaimers).
  //
  // The SAME function ProfileCompletionGate uses, not a mirror of it, so Suspense
  // resolution order cannot decide where the user lands and the two cannot
  // desynchronise. This previously hand-copied the condition list AND used a
  // wider member scope than the profile gate; see profileGatePending() for what
  // that disagreement was hiding.
  if (profileGatePending(data)) return null;

  const state = await getDisclaimerStateCached(data.family);
  if (!state.accepted) redirect('/acknowledgements');
  return null;
}

// Adult Study Class gate (P4). Runs on every /family/* render AFTER the profile
// and disclaimer gates. Per-family: only the MANAGER chooses. Redirects to the
// top-level /adult-class (OUTSIDE this layout, like /complete-profile and
// /acknowledgements) when the family still owes a selection. Flag-gated OFF by
// default.
export async function AdultClassGate() {
  if (!flags.setuAdultClass) return null;

  const data = await getCurrentFamily();
  if (!data) return null; // unauthenticated — middleware handles it

  // Defer to BOTH earlier gates. Not a hand-copied mirror: earlierGatesPending
  // composes profileGatePending with the disclaimer read, and respects the
  // setuDisclaimers flag so turning disclaimers OFF cannot silently disable this
  // gate too.
  if (await earlierGatesPending(data)) return null;

  // The FAIL-SOFT loader, never loadAdultClassGateDataOrThrow. This gate
  // redirects on every /family/* render, so a transient Firestore error must
  // cost the family an un-asked question rather than a 500 across the portal.
  // The two variants have identical signatures, so nothing but this line and its
  // test stops the wrong one being pasted here.
  const gate = await loadAdultClassGateDataFailSoft(data);
  if (!gate) return null;

  if (needsAdultClassSelection(gate)) redirect('/adult-class');
  return null;
}

// The layout itself stays synchronous so cacheComponents:true can stream the
// static shell. The two awaited data fetches (sidebar identity, page body) are
// each wrapped in their own <Suspense> boundary so the rest of the chrome
// renders immediately.

async function SidebarWithIdentity() {
  const [data, sevak] = await Promise.all([getCurrentFamily(), readSevakFlagsFromCookie()]);
  let displayName: string | undefined;
  let subtitle: string | undefined;
  if (data) {
    const currentMember = data.members.find((m) => m.mid === data.currentMid);
    if (currentMember) displayName = `${currentMember.firstName} ${currentMember.lastName}`;
    // Show the friendly publicFid only when it is set (Model Y2 mints it at first
    // enrollment); the internal CMT- id is never shown on this family-facing
    // sidebar. The legacy check-in id still shows when present.
    const fidClause = data.family.publicFid ? ` · FID ${data.family.publicFid}` : '';
    const legacyClause = data.family.legacyFid ? ` · Legacy ${data.family.legacyFid}` : '';
    subtitle = `${data.family.name}${fidClause}${legacyClause}`;
  }
  return <DesktopSidebarLive displayName={displayName} subtitle={subtitle} showSignOut isAdmin={sevak.isAdmin} showTeacher={sevak.showTeacher} staffArea={sevak.staffArea} yearBadge={<SchoolYearBadge />}/>;
}

// Mobile bottom nav needs isAdmin/showTeacher to decide whether the "More" sheet
// shows the Admin / Teacher shortcuts. Computed the same way as the desktop sidebar.
async function MobileNavWithIdentity() {
  const sevak = await readSevakFlagsFromCookie();
  return <MobileBottomNav isAdmin={sevak.isAdmin} showTeacher={sevak.showTeacher} staffArea={sevak.staffArea} />;
}

/** What staff area (if any) this family member can also reach. */
type SevakFlags = {
  isAdmin: boolean;
  showTeacher: boolean;
  staffArea: 'welcome-team' | 'coordinator' | null;
};

// Reads the session cookie once and derives which staff shortcuts the family
// chrome should offer. Returns all-false on any error (missing cookie, expired
// session) — silent failure is fine because middleware gates the destinations
// themselves. Teacher is additionally gated on the flags.setuTeacher flag.
//
// `staffArea` is the fix for a real report (2026-08-03): an admin granted a
// parent the welcome-team role, the grant landed correctly in
// roleAssignments/{mid}, and the parent still saw no way in — because this
// function only ever asked about admin and teacher, so the Sevak section could
// only ever render those two links. A capability nobody can navigate to is
// indistinguishable from a capability that was never granted.
//
// Admins are excluded on purpose: they already get the Admin link, and the
// admin dashboard links /welcome as "Family search". isWelcomeTeam() and
// isCoordinator() both return true for admin, hence the explicit !isAdmin.
async function readSevakFlagsFromCookie(): Promise<SevakFlags> {
  const none: SevakFlags = { isAdmin: false, showTeacher: false, staffArea: null };
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return none;
    const claims = await verifyPortalSessionCookie(sessionCookie).catch(() => null);
    if (!claims) return none;
    const withRole = claims as unknown as WithRole;
    const admin = isAdmin(withRole);
    return {
      isAdmin: admin,
      showTeacher: flags.setuTeacher && isTeacher(withRole),
      // Coordinator is tested FIRST, and the order is load-bearing: since
      // 2026-08-05 isWelcomeTeam() returns true for a coordinator, so asking it
      // first would label every coordinator "Welcome team" and the branch below
      // would be unreachable. Someone holding both grants is shown the senior
      // title. Matches the /welcome layout's own label derivation.
      staffArea: admin
        ? null
        : hasRole(withRole, 'coordinator')
          ? 'coordinator'
          : isWelcomeTeam(withRole)
            ? 'welcome-team'
            : null,
    };
  } catch {
    return none;
  }
}

export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Profile-completion gate. Its own Suspense boundary (it awaits the
          session + family + pathname) so the static shell still streams under
          cacheComponents. Renders nothing — it either redirects or no-ops. */}
      <Suspense fallback={null}>
        <ProfileCompletionGate />
      </Suspense>

      {/* Disclaimer-acceptance gate (Slice 2). Its own Suspense boundary; renders
          AFTER the profile gate. Renders nothing — it either redirects to
          /disclaimers (a not-yet-accepted manager) or no-ops. */}
      <Suspense fallback={null}>
        <DisclaimerGate />
      </Suspense>

      {/* Adult Study Class gate (P4). Its own Suspense boundary; ordered AFTER
          the disclaimer gate. Renders nothing — it either redirects to
          /adult-class or no-ops. MOUNTING IS THE WHOLE FEATURE: every predicate
          and route test passes while this element is absent, so
          __tests__/adult-class-gate.test.tsx asserts this JSX exists and sits
          after <DisclaimerGate />. */}
      <Suspense fallback={null}>
        <AdultClassGate />
      </Suspense>

      {/* ── 🔴 {children} IS MOUNTED EXACTLY ONCE. DO NOT SPLIT IT AGAIN. ──────
          This layout used to render {children} TWICE - once inside a
          `block md:hidden` div for phones and again inside a `hidden md:flex`
          div for desktop - each in its own <Suspense>. Same element, two
          independent mounts, both live in the DOM at once with CSS hiding one.

          That is what broke the portal. On 2026-08-04 the owner reported that
          on Safari on a real iPhone, tapping anything did nothing: "Manage
          family", the bottom nav, "Add a child to enroll" - all dead - while
          "in browser responsive view everything works".

          It was never slowness. The server answers the destination's RSC
          request in ~170ms. What died was the client-side NAVIGATION: React
          threw while applying the payload and the router transition never
          committed, so the URL never changed. The page you were standing on
          stayed fully interactive - sheets opened, toggles worked - which is
          precisely why families described it as the app freezing rather than
          as a broken page, and why it survived a month as issue #62 (in Sentry
          since 2026-07-10).

          MEASURED, against a local production build, tapping a nav link and
          timing the URL change, 3 runs per hop per engine:

            two mounts (before)   WebKit  DEAD >15s  6/6     Chromium DEAD 2/6
            one mount  (this)     WebKit  272-286ms 12/12    Chromium ok 12/12

          Note the Chromium column: this was NOT a Safari-only fault. Safari
          lost the race almost every time and Chromium about a third of the
          time, which is why it read as random and why laptop testing missed it.

          The likely mechanism is that Next treats the resolved route segment as
          a single owned resource; asking for it from two independent Suspense
          positions means one mount claims it and the other silently never does.
          Whichever internal system is responsible, the precondition is the
          duplication - so removing the duplication is the fix, not tuning the
          boundaries around it.

          Two things that did NOT work, so nobody re-tries them: giving each
          gate <Suspense> its own container element made it WORSE (it broke
          Chromium too, 2/2), and wrapping the three gates in a Fragment fixed it
          while producing byte-identical DOM, i.e. for no explicable reason.

          The mobile/desktop difference is now pure CSS around this one mount.
          `md:` utilities hide the sidebar and drop the desktop padding on
          phones; every page keeps its own responsive branching internally,
          which is safe - that is one component returning both variants from a
          single render, not two mounts of a shared subtree.

          Guarded by e2e/setu/client-navigation.spec.ts, which runs under real
          WebKit and fails if a nav tap stops navigating.

          Bonus fix: the inner element is a <div>, not <main>. The root layout
          (app/layout.tsx:63) already renders <main className="flex-1">, and the
          HTML spec forbids <main> inside <main>. The welcome and admin layouts
          still have that nesting. */}
      <CspRoot className="flex" style={{ minHeight: '100dvh' }}>
          {/* ── 🔴 The wrapper is load-bearing, not cosmetic ────────────────────
              Reported repeatedly as "blank page / broken CSS after a mutation,
              fixed by a hard refresh". Caught live on 2026-07-28 in the owner's
              browser and dissected: the page content was rendering INSIDE this
              sidebar's <aside> (the visible h1 at x=18 w=211 instead of x=296
              w=1384). The stylesheet was fine - 588 rules, `md:` utilities
              resolving - so nothing was ever "unstyled"; the content was in the
              wrong box.

              React streams a Suspense boundary in by locating its comment
              markers AMONG ITS PARENT'S CHILDREN. Left unwrapped, this boundary
              and <main> are siblings of one flex parent, so a marker mismatch
              lets the boundary swallow what follows it - which is exactly
              <main> and the whole page. <main>'s own boundary was never at risk
              because it is already contained by <main> itself; this was the one
              loose boundary in the shell.

              So give it a container of its own. Purely structural: the wrapper
              is a flex item whose width comes from the 248px <aside> inside it,
              and `display:flex` lets that aside stretch to full height exactly
              as it did when it was the flex item. Renders identically.

              ⚠️ THIS DID NOT FIX THE REPORTED BUG. Verified against the
              deployed build immediately after shipping it: the dashboard still
              lands inside the <aside>, now inside this very wrapper. Containing
              the boundary is still correct hygiene - a loose boundary among
              siblings is a real hazard and this shell was the only one with it -
              so the wrapper stays. But do not read it as the cure.

              WHAT IT ACTUALLY IS (evidence, 2026-07-28, live in the owner's
              browser). When broken, the sidebar has FOUR children instead of
              three; the extra one holds a second copy of sidebar markup wrapping
              the whole page, fenced by React's own `<!--&-->`/`<!--$-->`
              Activity+Suspense markers. Crucially that node has **no
              `__reactFiber$` key**, so React never claimed it: it is ORPHANED
              SERVER HTML left behind after hydration bailed, while React's real
              tree is one of the zero-width copies. That is a hydration failure,
              not a streaming-marker misplacement - which is why wrapping the
              boundary changed nothing.

              DISCRIMINATOR for any future check - and note the trap: use the
              VISIBLE aside, because `document.querySelector('aside')` returns a
              hidden mobile one and reports false health.
                [...document.querySelectorAll('aside')]
                  .find(a => a.getBoundingClientRect().width > 0)
              Broken: 4 children, textContent includes the greeting.
              Healthy: 3 children.

              NEXT STEP is to catch the hydration error itself - Sentry has been
              wired since 2026-06-26 and would have been recording React #418 /
              #423 / #425 all along. Vercel Skew Protection (which would remove
              the deploy-boundary trigger) is Pro-only; this team is on Hobby. */}
        {/* Sidebar is desktop-only; `hidden md:flex` replaces the old
            `display:flex` wrapper AND the outer breakpoint div in one element,
            keeping the boundary contained exactly as the note above requires. */}
        <div className="hidden md:flex">
          <Suspense fallback={<DesktopSidebar showSignOut/>}>
            <SidebarWithIdentity />
          </Suspense>
        </div>

        {/* THE single {children} mount. Desktop padding/scrolling only; on a
            phone each page supplies its own padding, exactly as before. */}
        <div className="flex-1 md:overflow-auto md:px-12 md:py-8">
          <Suspense fallback={<LoadingOm />}>
            {children}
          </Suspense>
        </div>

        {/* Bottom nav is phone-only. It renders a position:fixed bar, so this
            wrapper takes no space in the flex row. */}
        <div className="block md:hidden">
          <Suspense fallback={null}>
            <MobileNavWithIdentity />
          </Suspense>
        </div>
      </CspRoot>
    </>
  );
}
