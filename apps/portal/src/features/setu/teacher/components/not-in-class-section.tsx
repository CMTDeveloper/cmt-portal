'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@cmt/ui';

/** A carry-forward student passed from the server (already computed). */
export interface PreviousRow {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
}
/** A registered-but-unenrolled child, lazy-loaded on expand. */
interface EligibleRow {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  familyName: string;
}

interface Props {
  levelId: string;
  date: string;
  previousStudents: PreviousRow[];
}

/** First glyph of a name for the row avatar. */
function glyph(name: string): string {
  return name.trim()[0]?.toUpperCase() ?? '·';
}

const groupHeading: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: '4px 0 8px',
};

const searchInput: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  margin: '0 0 10px',
  fontSize: 14,
  fontFamily: 'var(--body)',
  color: 'var(--ink)',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
};

// The registered · not-enrolled pool at a busy location is dozens deep (Brampton
// Level 2 ≈ 54). Show the first slice and let a teacher search for the rest, so
// the section stays scannable without hiding anyone.
const REGISTERED_CAP = 20;

/**
 * The consolidated "Not in this class yet" section on the attendance screen. Two
 * headed groups so a teacher scans one list, not several (Vaibhav):
 *  - Previous students — carry-forwards from last year (confirm in place).
 *  - Registered · not enrolled — grade-match children with no enrollment (enroll).
 * Marking present in EITHER adds the child to this year's class. Previous students
 * are already loaded server-side; the registered group is fetched on first expand
 * (a broad location scan, so it never slows the initial page load).
 */
export function NotInClassSection({ levelId, date, previousStudents }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [previous, setPrevious] = useState<PreviousRow[]>(previousStudents);
  const [eligible, setEligible] = useState<EligibleRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyMid, setBusyMid] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Lazy-load the registered-but-unenrolled group the first time the section opens.
  useEffect(() => {
    if (!expanded || eligible !== null || loading) return;
    setLoading(true);
    setLoadError(false);
    fetch(`/api/setu/teacher/grade-eligible?levelId=${encodeURIComponent(levelId)}`, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { view?: { students?: EligibleRow[] } };
        setEligible(data.view?.students ?? []);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [expanded, eligible, loading, levelId]);

  function confirmPrevious(row: PreviousRow) {
    setBusyMid(row.mid);
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/attendance/confirm-previous', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ levelId, mid: row.mid, date }),
        });
        if (!res.ok) return void toast.error('Could not mark present - please try again.');
        toast.success(`${row.firstName} added to this year's class.`);
        setPrevious((prev) => prev.filter((r) => r.fid !== row.fid)); // siblings confirm together
        router.refresh();
      } catch {
        toast.error('Network error - please try again.');
      } finally {
        setBusyMid(null);
      }
    });
  }

  function enrollEligible(row: EligibleRow) {
    setBusyMid(row.mid);
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/grade-eligible', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ levelId, mid: row.mid, date }),
        });
        if (!res.ok) return void toast.error('Could not add to the class - please try again.');
        toast.success(`${row.firstName} enrolled and marked present.`);
        setEligible((prev) => (prev ?? []).filter((r) => r.mid !== row.mid));
        router.refresh();
      } catch {
        toast.error('Network error - please try again.');
      } finally {
        setBusyMid(null);
      }
    });
  }

  const knownCount = previous.length + (eligible?.length ?? 0);
  const loadedEmpty = eligible !== null && previous.length === 0 && eligible.length === 0;

  // Registered group: filter by the search box, then cap the default view. A
  // search reveals matches beyond the cap; an active query keeps the box visible
  // even after the pool shrinks below the cap (so a filter is always clearable).
  const eligibleList = eligible ?? [];
  const q = query.trim().toLowerCase();
  const filteredEligible = q
    ? eligibleList.filter((r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) || r.familyName.toLowerCase().includes(q))
    : eligibleList;
  const shownEligible = q ? filteredEligible : filteredEligible.slice(0, REGISTERED_CAP);
  const showSearch = eligibleList.length > REGISTERED_CAP || q.length > 0;
  const showCapFooter = !q && eligibleList.length > REGISTERED_CAP;

  return (
    <section style={{ marginTop: 20 }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 14px',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          cursor: 'pointer',
          fontFamily: 'var(--body)',
          textAlign: 'left',
        }}
      >
        <span aria-hidden style={{ fontSize: 13, color: 'var(--muted)', transition: 'transform .15s ease', transform: expanded ? 'rotate(90deg)' : 'none' }}>›</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Not in this class yet</span>
        {knownCount > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accentDeep)', background: 'var(--accentSoft)', borderRadius: 99, padding: '2px 9px', minWidth: 22, textAlign: 'center' }}>
            {knownCount}
          </span>
        )}
      </button>

      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Registered · not enrolled FIRST (Vaibhav): a teacher is most likely
              looking for a walk-in registered child to enroll on the spot. */}
          <div>
            <h3 style={groupHeading}>Registered · not enrolled{eligible && eligible.length > 0 ? ` (${eligible.length})` : ''}</h3>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
              Registered for this location and grade, but not enrolled in Bala Vihar. Mark one present to enroll them.
            </p>
            {loading && <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 2px' }}>Loading registered students…</div>}
            {loadError && (
              <button type="button" onClick={() => { setEligible(null); setLoadError(false); }} className="btn btn--g" style={{ fontSize: 13 }}>
                Could not load - retry
              </button>
            )}
            {eligible !== null && eligible.length > 0 && (
              <>
                {showSearch && (
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name…"
                    aria-label="Search registered students"
                    style={searchInput}
                  />
                )}
                {shownEligible.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {shownEligible.map((row) => (
                      <PersonRow
                        key={row.mid}
                        name={`${row.firstName} ${row.lastName}`}
                        grade={row.schoolGrade}
                        sub={row.familyName}
                        busy={pending && busyMid === row.mid}
                        onMark={() => enrollEligible(row)}
                      />
                    ))}
                  </div>
                )}
                {q && shownEligible.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 2px' }}>No registered students match “{query.trim()}”.</div>
                )}
                {showCapFooter && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 2px 0' }}>
                    Showing {REGISTERED_CAP} of {eligible.length} · search to add others
                  </div>
                )}
              </>
            )}
            {eligible !== null && eligible.length === 0 && !loadError && (
              <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 2px' }}>No registered students waiting to enroll.</div>
            )}
          </div>

          {previous.length > 0 && (
            <div>
              <h3 style={groupHeading}>Previous students ({previous.length})</h3>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
                Returning from last year. Mark one present to add their family to this year&apos;s class.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {previous.map((row) => (
                  <PersonRow
                    key={row.mid}
                    name={`${row.firstName} ${row.lastName}`}
                    grade={row.schoolGrade}
                    sub={null}
                    busy={pending && busyMid === row.mid}
                    onMark={() => confirmPrevious(row)}
                  />
                ))}
              </div>
            </div>
          )}

          {loadedEmpty && (
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '4px 2px' }}>
              Everyone eligible for this class is already enrolled.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** One person row with a "Mark present" action. Shared by both groups. */
function PersonRow({ name, grade, sub, busy, onMark }: { name: string; grade: string | null; sub: string | null; busy: boolean; onMark: () => void }) {
  return (
    <div className="card" style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)' }}>
      <span aria-hidden style={{ flexShrink: 0, width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, background: 'var(--info-soft)', color: 'var(--info-deep)' }}>
        {glyph(name)}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{name}</div>
        <div className="row" style={{ gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          {grade && <span className="pill" style={{ fontSize: 11, fontWeight: 600, background: 'var(--info-soft)', color: 'var(--info-deep)' }}>{grade}</span>}
          {sub && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sub}</span>}
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onMark}
        className="btn btn--p"
        style={{ flexShrink: 0, fontSize: 14, padding: '11px 16px', minHeight: 44, whiteSpace: 'nowrap', opacity: busy ? 0.65 : 1 }}
      >
        {busy ? 'Saving…' : 'Mark present'}
      </button>
    </div>
  );
}
