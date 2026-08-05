import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, type WithRole } from '@cmt/shared-domain';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { StaffMemberEditClient } from '@/features/setu/members/staff-member-edit-client';

export const metadata = { title: 'Edit member' };

export default function WelcomeMemberEditPage({
  params,
}: {
  params: Promise<{ fid: string; mid: string }>;
}) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading…</div>}>
      <WelcomeMemberEditBody params={params} />
    </Suspense>
  );
}

/**
 * Staff edit of a member in ANY family.
 *
 * Vaibhav, 2026-08-05: *"Welcome (and admin for sure) team needs to be able to
 * manage this for families ... Search any family and view AND UPDATE family/
 * member detail at /welcome"*, prompted by the two checkboxes that shipped for
 * families on 2026-08-04.
 *
 * The API for this already existed - PATCH /api/welcome/families/{fid}/members/
 * {mid} has passed canSetManagerFlag and canSetParticipation into the shared
 * write core since it shipped. Only the screen was missing, which is why this
 * page is thin: session gate, one read, hand off to the form the family uses.
 *
 * Exported separately from the default export for testing - the default is a
 * thin Suspense wrapper, which Next 16 Cache Components require around any
 * dynamic data access.
 */
export async function WelcomeMemberEditBody({
  params,
}: {
  params: Promise<{ fid: string; mid: string }>;
}) {
  // Gate 2 of three. Middleware (canAccessRoute's /welcome/family/ prefix)
  // is gate 1 and the route handler is gate 3; a page that trusted middleware
  // alone would be one config edit away from being open.
  await connection();
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  if (!raw || !isWelcomeTeam(raw as unknown as WithRole)) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
      </div>
    );
  }

  const { fid, mid } = await params;

  // Reuses the reader behind the staff family detail page rather than adding a
  // third member projection. It returns MemberDoc[] - a NAMED type - which is
  // what makes a future schema field a compile error here instead of a silent
  // omission. Its `use cache` entry is tagged `family-{fid}` and the write core
  // revalidates that tag, so a save is reflected on the way back.
  const data = await getFamilyByFid(fid);
  const member = data?.members.find((m) => m.mid === mid);
  // mid must belong to the route's fid - guards against URL tampering.
  if (!member) notFound();

  const initial = {
    mid: member.mid,
    firstName: member.firstName,
    lastName: member.lastName,
    type: member.type,
    gender: member.gender,
    schoolGrade: member.schoolGrade ?? null,
    birthMonthYear: member.birthMonthYear ?? null,
    foodAllergies: member.foodAllergies ?? null,
    email: member.email ?? null,
    phone: member.phone ?? null,
    volunteeringSkills: member.volunteeringSkills ?? [],
    manager: member.manager,
    ...(member.participation === 'inactive' ? { participation: 'inactive' as const } : {}),
  };

  // Rendered ONCE, deliberately. The sibling pages on this route each render a
  // `block md:hidden` tree and a `hidden md:block` tree, and copying that shape
  // here would be a bug: MemberEditForm ALREADY contains both branches, so
  // wrapping it in another pair mounts the whole form TWICE. That is task #62 -
  // the family layout mounted {children} twice and killed every client-side
  // navigation on the site for three weeks. Tailwind hides one branch visually;
  // it does not stop React mounting it.
  //
  // CspRoot is not added here either: the welcome layout supplies one on both
  // its phone and desktop branches, and the form's own mobile branch brings a
  // second for the full-height sheet.
  return <StaffMemberEditClient fid={fid} mid={mid} initial={initial} />;
}
