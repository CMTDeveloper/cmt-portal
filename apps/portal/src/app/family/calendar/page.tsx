import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getPublishedCalendar, getWeeklySchedule, type CalendarEntry } from '@/features/setu/calendar/calendar';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';

export const metadata = { title: 'Class calendar' };

function fmtDay(ymd: string) {
  // Render at noon to avoid TZ slippage; the date IS the Toronto class date.
  const d = new Date(`${ymd}T12:00:00`);
  return {
    weekday: d.toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'America/Toronto' }),
    day: d.toLocaleDateString('en-CA', { day: 'numeric', timeZone: 'America/Toronto' }),
    month: d.toLocaleDateString('en-CA', { month: 'short', timeZone: 'America/Toronto' }),
  };
}

function monthKey(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'America/Toronto' });
}

function classTitle(e: CalendarEntry): string {
  if (e.kind === 'no-class') return `No class${e.noClassReason ? ` · ${e.noClassReason}` : ''}`;
  const t = e.classType === 'first' ? 'First class' : e.classType === 'short' ? 'Short class' : 'Class';
  return t;
}

function groupByMonth(entries: CalendarEntry[]): Array<[string, CalendarEntry[]]> {
  const map = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const k = monthKey(e.date);
    const arr = map.get(k) ?? [];
    arr.push(e);
    map.set(k, arr);
  }
  return [...map.entries()];
}

export default async function FamilyCalendarPage() {
  await connection();

  const data = await getCurrentFamily();
  const location = data?.family.location ?? null;

  // BV-centric family calendar — scope to 'bala-vihar' so a second usesCalendar
  // program's dates don't appear under the Bala Vihar heading, and to the live
  // school year so cloned next-year (preparing) Sundays stay hidden until Activate.
  const liveYear = await getLiveSchoolYearCached();
  const [entries, weekly] = location
    ? await Promise.all([getPublishedCalendar(location, 'bala-vihar', liveYear), getWeeklySchedule(location)])
    : [[], []];

  const months = groupByMonth(entries);

  const body = (
    <>
      <Link href="/family" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
        <SetuIcon.back /> Back
      </Link>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>Class calendar</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
        Bala Vihar {location ? `· ${location}` : ''} — the school-year Sunday schedule.
      </p>

      {weekly.length > 0 && (
        <div className="card" style={{ padding: 16, marginTop: 18 }}>
          <SectionLabel>Sunday schedule</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {weekly.map((r, i) => (
              <div key={i} className="row" style={{ gap: 12, fontSize: 13 }}>
                <span style={{ color: 'var(--muted)', minWidth: 120 }}>{r.time}</span>
                <span>{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="card" style={{ padding: 24, marginTop: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          The class calendar hasn&apos;t been published yet. Check back soon.
        </div>
      ) : (
        months.map(([month, monthEntries]) => (
          <div key={month} style={{ marginTop: 22 }}>
            <SectionLabel>{month}</SectionLabel>
            <div className="card" style={{ padding: 8, marginTop: 8 }}>
              {monthEntries.map((e) => {
                const f = fmtDay(e.date);
                const noClass = e.kind === 'no-class';
                return (
                  <div key={e.entryId} className="row" style={{ gap: 12, padding: '10px 10px', alignItems: 'flex-start' }}>
                    <div style={{ width: 46, padding: '6px 0', textAlign: 'center', background: noClass ? 'var(--surface2)' : 'var(--accentSoft)', borderRadius: 'var(--radiusSm)' }}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{f.month}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, marginTop: -2, color: noClass ? 'var(--muted)' : 'var(--accentDeep)' }}>{f.day}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: noClass ? 'var(--muted)' : 'var(--ink)' }}>{classTitle(e)}</div>
                      {e.specialEvents && <div style={{ fontSize: 12, color: 'var(--accentDeep)', marginTop: 2 }}>{e.specialEvents}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );

  return (
    <>
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '16px 18px 90px' }}>{body}</div>
        </CspRoot>
      </div>
      <div className="hidden md:block" style={{ maxWidth: 680 }}>
        {body}
      </div>
    </>
  );
}
