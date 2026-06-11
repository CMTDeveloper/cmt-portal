import { Suspense } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, type WithRole } from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import {
  getUpcomingPrasad,
  type PrasadContact,
  type PrasadLocation,
  type PrasadSunday,
} from '@/features/setu/prasad/upcoming';

export const metadata: Metadata = {
  title: 'Prasad · Setu',
};

export default function WelcomePrasadPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading prasad…</div>}>
      <WelcomePrasadBody />
    </Suspense>
  );
}

// Exported for testing — the default export is a thin Suspense wrapper (Next.js
// 16 Cache Components require dynamic data access inside <Suspense>).
export async function WelcomePrasadBody() {
  // Defensive role check — middleware enforces this but the Server Component
  // re-verifies (defense in depth). We do NOT read prasad data until welcome-team
  // is positively confirmed. isWelcomeTeam() handles admin inheritance + extraRoles.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  let allowed = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie);
    if (raw && isWelcomeTeam(raw as unknown as WithRole)) {
      allowed = true;
    }
  }
  if (!allowed) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
      </div>
    );
  }

  const { locations } = await getUpcomingPrasad();

  const body = <PrasadBody locations={locations} />;

  return (
    <>
      {/* Mobile — the /welcome layout renders the mobile branch as a bare
          pass-through; this page owns its own CspRoot + padding (and clears the
          fixed bottom nav). */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh', padding: '18px 18px 96px' }}>
          <Header />
          {body}
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns the sidebar + padded <main>. */}
      <div className="hidden md:block">
        <Header />
        {body}
      </div>
    </>
  );
}

function Header() {
  return (
    <header style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 600 }}>
        Prasad seva
      </p>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4 }}>Upcoming prasad Sundays</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
        Who is bringing prasad on the next few assembly Sundays — and how to reach them.
      </p>
    </header>
  );
}

function PrasadBody({ locations }: { locations: PrasadLocation[] }) {
  return (
    <div className="col" style={{ gap: 28, maxWidth: 720 }}>
      {locations.map((loc) => (
        <LocationSection key={loc.location} location={loc} />
      ))}
    </div>
  );
}

function LocationSection({ location }: { location: PrasadLocation }) {
  return (
    <section>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>{location.location}</h2>
      {location.sundays.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <p style={{ fontSize: 13.5, color: 'var(--body-text)', lineHeight: 1.55 }}>
            No upcoming prasad Sundays — publish the schedule from Admin → Prasad rotation.
          </p>
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {location.sundays.map((sunday) => (
            <SundayCard key={sunday.date} sunday={sunday} />
          ))}
        </div>
      )}
    </section>
  );
}

function SundayCard({ sunday }: { sunday: PrasadSunday }) {
  const confirmed = sunday.families.filter((f) => f.status === 'assigned').length;
  const proposed = sunday.families.length - confirmed;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="between" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{formatSunday(sunday.date)}</div>
        <span style={{ flex: '0 0 auto', fontSize: 11, padding: '2px 9px', borderRadius: 99, fontWeight: 600, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>
          {confirmed} confirmed · {proposed} proposed
        </span>
      </div>
      <div className="col" style={{ gap: 10 }}>
        {sunday.families.map((family) => (
          <div key={family.fid}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{family.familyName}</div>
              {family.status === 'proposed' ? (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--setu-warn-soft)', color: 'var(--warn, #a06410)', textTransform: 'uppercase' }}>
                  not confirmed
                </span>
              ) : null}
            </div>
            {family.contacts.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>No manager contact on file</div>
            ) : (
              family.contacts.map((contact, i) => (
                <div key={contact.email ?? contact.phone ?? String(i)} style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                  {formatContact(contact)}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// YYYY-MM-DD → "Sun, Mar 22" in en-CA, parsed as UTC so the calendar day never
// shifts across the Vercel function's timezone.
function formatSunday(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

// "Asha Patel · asha@x.com · (416) 555-1212" with null parts omitted.
function formatContact(contact: PrasadContact): string {
  return [contact.name, contact.email, contact.phone].filter((p): p is string => Boolean(p)).join(' · ');
}
