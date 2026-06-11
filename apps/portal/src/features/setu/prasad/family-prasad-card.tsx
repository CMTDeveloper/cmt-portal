'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from '@cmt/ui';
import type { FamilyPrasadView, MoveOption } from './family-assignment';
import { confirmPrasad, fetchMoveOptions, movePrasad } from './prasad-client';

interface FamilyPrasadCardProps {
  assignment: FamilyPrasadView | null;
  /** When true, render the expanded full-width page variant (used by /family/prasad). */
  expanded?: boolean;
}

/**
 * Format a YYYY-MM-DD class-day string for display ("Sun, Mar 22").
 *
 * Parsed via Date.UTC + a UTC-pinned formatter — NEVER `new Date('YYYY-MM-DD')`
 * straight into a local-TZ formatter, which would treat the string as midnight
 * UTC and shift the calendar day backward for any negative-offset zone (e.g.
 * America/Toronto), making a Sunday read as the preceding Saturday.
 */
const PRASAD_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function formatPrasadDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return PRASAD_DATE_FMT.format(new Date(Date.UTC(y, m - 1, d)));
}

/** The cake why-line is reserved for a birthday-month placement with a named child. */
function whyLine(assignment: FamilyPrasadView): string {
  if (assignment.reason === 'birthday-month' && assignment.youngestName) {
    return `${assignment.youngestName}'s birthday month 🎂`;
  }
  return 'Assigned by the welcome team';
}

const BLURB = 'Bring prasad for the assembly — enough to share. Thank you for serving!';

/**
 * Family-facing prasad seva card.
 *
 * Renders null when the family has no published assignment for the current
 * period (the server passes `assignment === null`) — the dashboard simply omits
 * the slot rather than showing an empty placeholder.
 *
 * When `assignment.movable`, a secondary "Move my date" button opens a single
 * fixed-position overlay that reads as a bottom sheet on mobile and a centred
 * dialog on desktop (one element, responsive styling). The overlay is wrapped
 * in CspRoot so the Setu brand tokens resolve — fixed-position chrome escapes
 * the page's .csp ancestor, and tokens are .csp-scoped.
 *
 * When `assignment.status === 'proposed'` the card renders the propose→confirm
 * state instead: a "Confirm this date" primary CTA (confirms in place) plus a
 * "Pick a different Sunday" secondary CTA that opens the same sheet in
 * `'choose'` mode (picking a Sunday confirms it there). No lock note and no
 * move button in this state — a proposal has nothing to lock.
 */
export function FamilyPrasadCard({ assignment, expanded = false }: FamilyPrasadCardProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!assignment) return null;

  const proposed = assignment.status === 'proposed';
  const dateLabel = formatPrasadDate(assignment.date);

  async function confirmInPlace() {
    if (confirming) return;
    setConfirming(true);
    try {
      await confirmPrasad(undefined);
      toast.success('Prasad Sunday confirmed — thank you!');
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'already-confirmed') {
        toast.error('Already confirmed.');
      } else {
        toast.error('Could not confirm. Please try again.');
      }
      setConfirming(false);
    }
  }

  return (
    <>
      <div
        className="card"
        style={{ padding: expanded ? 24 : 16 }}
        data-testid="family-prasad-card"
      >
        <div className="between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                textTransform: 'uppercase',
                letterSpacing: '.1em',
                fontWeight: 600,
              }}
            >
              Prasad seva
            </div>
            <h3
              style={{
                fontSize: expanded ? 18 : 15,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                marginTop: 3,
                color: 'var(--ink)',
              }}
            >
              {proposed ? 'Suggested prasad Sunday' : 'Your prasad Sunday'}
            </h3>
          </div>
          <span
            aria-hidden
            style={{
              flex: '0 0 auto',
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'var(--accentSoft)',
              color: 'var(--accent)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {/* Offering bowl mark — a quiet domain glyph rather than a generic icon. */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 11h18a9 9 0 0 1-18 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M12 11V8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M9.5 8c0-1.4 1.1-2.5 2.5-2.5S14.5 6.6 14.5 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
        </div>

        <div
          style={{
            fontSize: expanded ? 30 : 24,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
          }}
        >
          {dateLabel}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--accentDeep)', marginTop: 4, fontWeight: 600 }}>
          {whyLine(assignment)}
        </div>

        <p
          style={{
            fontSize: 12.5,
            color: 'var(--body-text)',
            lineHeight: 1.5,
            marginTop: 12,
          }}
        >
          {BLURB}
        </p>

        {proposed ? (
          <>
            <button
              type="button"
              data-testid="prasad-confirm"
              onClick={() => void confirmInPlace()}
              disabled={confirming}
              className="btn btn--p btn--block"
              style={{ marginTop: 14, minHeight: 44, fontSize: 13, opacity: confirming ? 0.6 : 1 }}
            >
              {confirming ? 'Confirming…' : 'Confirm this date'}
            </button>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              disabled={confirming}
              className="btn btn--s btn--block"
              style={{ marginTop: 8, minHeight: 44, fontSize: 13 }}
            >
              Pick a different Sunday
            </button>
          </>
        ) : assignment.movable ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="btn btn--s btn--block"
            style={{ marginTop: 14, minHeight: 44, fontSize: 13 }}
          >
            Can&rsquo;t make it? Move my date
          </button>
        ) : (
          <p
            style={{
              fontSize: 11.5,
              color: 'var(--muted)',
              lineHeight: 1.5,
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid var(--line)',
            }}
          >
            Date locked — within a week of your Sunday. Contact the welcome team if you need a change.
          </p>
        )}

        {!expanded && (
          <Link
            href="/family/prasad"
            className="focus-ring"
            style={{
              display: 'inline-block',
              marginTop: 12,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--accent)',
              textDecoration: 'none',
            }}
          >
            View details →
          </Link>
        )}
      </div>

      {sheetOpen && (
        <MovePrasadSheet
          mode={proposed ? 'choose' : 'move'}
          currentDate={dateLabel}
          onClose={() => setSheetOpen(false)}
          onMoved={() => {
            setSheetOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

interface MovePrasadSheetProps {
  /**
   * `'move'` — an assigned family moving its date (movePrasad). `'choose'` — a
   * proposed family picking its Sunday; confirming calls confirmPrasad(date).
   */
  mode: 'move' | 'choose';
  currentDate: string;
  onClose: () => void;
  onMoved: () => void;
}

/**
 * Bottom-sheet (mobile) / centred dialog (desktop) for picking a new prasad
 * Sunday. One fixed overlay, responsive panel: pinned to the bottom edge and
 * full-width on small screens, floated and width-capped on `md+`. Loads options
 * on mount; Confirm is disabled until a date is picked. Error messages are
 * mapped from the thrown Error.message the move/confirm client surfaces:
 * `'locked'` only applies in move mode, `'already-confirmed'` only in choose
 * mode; `'target-full'` reloads the options in both.
 */
function MovePrasadSheet({ mode, currentDate, onClose, onMoved }: MovePrasadSheetProps) {
  const [options, setOptions] = useState<MoveOption[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const loadOptions = useCallback(async () => {
    setOptions(null);
    setPicked(null);
    try {
      const opts = await fetchMoveOptions();
      setOptions(opts);
    } catch {
      setOptions([]);
      toast.error('Could not load other Sundays. Please try again.');
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  // Esc closes the sheet (unless a move is in flight).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !moving) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moving, onClose]);

  async function confirmMove() {
    if (!picked || moving) return;
    setMoving(true);
    try {
      if (mode === 'choose') {
        await confirmPrasad(picked);
        toast.success('Prasad Sunday confirmed — thank you!');
      } else {
        await movePrasad(picked);
        toast.success('Prasad day moved');
      }
      onMoved();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'target-full') {
        toast.error('That Sunday just filled up — pick another');
        setMoving(false);
        void loadOptions();
        return;
      }
      if (mode === 'choose' && code === 'already-confirmed') {
        toast.error('Already confirmed — refresh to see your date.');
      } else if (mode === 'move' && code === 'locked') {
        toast.error('Too close to your date to move it online — please contact the welcome team.');
      } else if (mode === 'choose') {
        toast.error('Could not confirm. Please try again.');
      } else {
        toast.error('Could not move your date. Please try again.');
      }
      setMoving(false);
    }
  }

  return (
    // Fixed overlay rendered OUTSIDE the page's CspRoot, so it carries
    // `className="csp"` itself or the Setu brand tokens resolve to nothing and
    // the sheet renders unstyled (same precedent as the rollover ConfirmDialog).
    // A raw div (not <CspRoot>) so it can take the dialog ARIA + onClick props.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-prasad-title"
      className="csp prasad-move-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        background: 'rgba(15,26,34,0.42)',
      }}
      onClick={() => {
        if (!moving) onClose();
      }}
    >
      <div
        className="prasad-move-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          boxShadow: '0 24px 60px rgba(15,26,34,0.28)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
        }}
      >
        <div style={{ padding: '20px 22px 14px' }}>
          <h2
            id="move-prasad-title"
            style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}
          >
            {mode === 'choose' ? 'Pick your prasad Sunday' : 'Move your prasad Sunday'}
          </h2>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
            {mode === 'choose' ? (
              <>
                You&rsquo;re suggested for <strong style={{ color: 'var(--ink)' }}>{currentDate}</strong>. Pick any
                Sunday with room — picking one confirms it.
              </>
            ) : (
              <>
                You&rsquo;re currently set for <strong style={{ color: 'var(--ink)' }}>{currentDate}</strong>. Pick
                another Sunday with room.
              </>
            )}
          </p>
        </div>

        <div style={{ overflowY: 'auto', padding: '0 22px', flex: 1 }}>
          {options === null ? (
            <div style={{ padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>Loading available Sundays…</div>
          ) : options.length === 0 ? (
            <div style={{ padding: '24px 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
              {mode === 'choose'
                ? 'No other Sundays have room right now — you can still confirm your suggested date, or check back later.'
                : 'No other Sundays have room right now. Please check back later or contact the welcome team.'}
            </div>
          ) : (
            <div role="radiogroup" aria-label="Available Sundays" className="col" style={{ gap: 8, paddingBottom: 8 }}>
              {options.map((opt) => {
                const active = picked === opt.date;
                return (
                  <button
                    key={opt.date}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPicked(opt.date)}
                    disabled={moving}
                    className="focus-ring"
                    style={{
                      width: '100%',
                      minHeight: 56,
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      textAlign: 'left',
                      cursor: moving ? 'default' : 'pointer',
                      background: active ? 'var(--accentSoft)' : 'var(--surface)',
                      border: '1px solid',
                      borderColor: active ? 'var(--accent)' : 'var(--line2)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 20,
                        height: 20,
                        flex: '0 0 auto',
                        borderRadius: '50%',
                        border: '2px solid',
                        borderColor: active ? 'var(--accent)' : 'var(--line2)',
                        background: active ? 'var(--accent)' : 'transparent',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {active && <span style={{ width: 8, height: 8, borderRadius: 99, background: '#fff' }} />}
                    </span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                      {formatPrasadDate(opt.date)}
                    </span>
                    <span
                      className="pill"
                      style={{ background: 'var(--surface2)', color: 'var(--muted)', fontSize: 11 }}
                    >
                      {opt.seatsLeft} spot{opt.seatsLeft === 1 ? '' : 's'} left
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '14px 22px 20px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            gap: 10,
            flexDirection: 'row-reverse',
          }}
        >
          <button
            type="button"
            onClick={confirmMove}
            disabled={!picked || moving}
            className="btn btn--p"
            style={{ flex: '1 1 160px', minHeight: 46, fontSize: 15, fontWeight: 600, opacity: !picked || moving ? 0.6 : 1 }}
          >
            {moving
              ? mode === 'choose'
                ? 'Confirming…'
                : 'Moving…'
              : mode === 'choose'
                ? 'Confirm this Sunday'
                : 'Confirm move'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={moving}
            className="btn btn--g"
            style={{ flex: '1 1 120px', minHeight: 46, fontSize: 15, fontWeight: 500 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
