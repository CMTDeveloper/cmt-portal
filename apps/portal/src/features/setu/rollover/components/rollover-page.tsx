'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast, SetuIcon, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cmt/ui';
import type { RolloverReport, YearReadiness } from '@cmt/shared-domain';
import {
  activateSchoolYearClient,
  commitPromotionClient,
  copyCalendarFromLastYearClient,
  copyPrasadFromLastYearClient,
  copySevaFromLastYearClient,
  copyTeachersFromLastYearClient,
  listSevaCandidatesClient,
  saveSchoolYearConfigClient,
  type SevaCandidateC,
} from '@/features/setu/rollover/rollover-client';
import { Spinner, StartStep } from './start-step';
import { PromoteStep } from './promote-step';
import { PromoteResult } from './promote-result';
import { ConfirmDialog } from './confirm-dialog';
import { YearReadinessChecklist } from './year-readiness-checklist';

export interface RolloverPageState {
  fromYear: string;
  toYear: string;
  /** True if any target-year BV level already exists (Step 1 ran before). */
  nextYearReady: boolean;
  sourceLevelCount: number;
  sourceOfferingCount: number;
  targetLevelCount: number;
  /** Per-item next-year readiness + the promotion gate — backs Step 3. */
  readiness: YearReadiness;
}

type Phase = 'idle' | 'preview' | 'committing' | 'done';

interface RolloverPageProps {
  state: RolloverPageState;
}

/** Owns the 2-step rollover flow state machine. Calls the thin -client fetch
 *  wrappers (so a native app hits the same endpoints) and surfaces every
 *  success/error via Sonner toast. */
export function RolloverPage({ state }: RolloverPageProps) {
  const { fromYear, toYear, sourceLevelCount, sourceOfferingCount } = state;
  const router = useRouter();

  const [startedThisSession, setStartedThisSession] = useState(false);
  const [report, setReport] = useState<RolloverReport | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editingYear, setEditingYear] = useState(false);
  const [yearDraft, setYearDraft] = useState(fromYear);
  const [savingYear, setSavingYear] = useState(false);
  const [activating, setActivating] = useState(false);
  const [copyingCalendar, setCopyingCalendar] = useState(false);
  const [copyingPrasad, setCopyingPrasad] = useState(false);
  const [copyingTeachers, setCopyingTeachers] = useState(false);
  const [copyingSeva, setCopyingSeva] = useState(false);
  const [sevaPickerOpen, setSevaPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<SevaCandidateC[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedOppIds, setSelectedOppIds] = useState<string[]>([]);
  const [decideLater, setDecideLater] = useState(false);

  useEffect(() => {
    setYearDraft(fromYear);
    setEditingYear(false);
    setStartedThisSession(false);
    setReport(null);
    setPhase('idle');
    setConfirmOpen(false);
    setActivating(false);
    setCopyingCalendar(false);
    setCopyingPrasad(false);
    setCopyingTeachers(false);
    setCopyingSeva(false);
    setSevaPickerOpen(false);
    setCandidates([]);
    setLoadingCandidates(false);
    setSelectedOppIds([]);
    setDecideLater(false);
  }, [fromYear, toYear]);

  const nextYearReady = state.nextYearReady || startedThisSession;
  const committing = phase === 'committing';

  async function commit() {
    setPhase('committing');
    try {
      const result = await commitPromotionClient();
      setReport(result);
      setConfirmOpen(false);
      setPhase('done');
      toast.success(`${result.promoted} promoted · ${result.graduated} graduated`);
    } catch {
      setPhase('preview');
      toast.error('Promotion failed. No changes were committed — please try again.');
    }
  }

  async function saveCurrentYear() {
    const nextYearDraft = yearDraft.trim();
    if (nextYearDraft === fromYear) {
      setEditingYear(false);
      return;
    }
    setSavingYear(true);
    try {
      await saveSchoolYearConfigClient(nextYearDraft);
      toast.success('Current school year saved');
      setEditingYear(false);
      router.refresh();
    } catch {
      toast.error('Enter a school year like 2026-27.');
    } finally {
      setSavingYear(false);
    }
  }

  async function activate() {
    setActivating(true);
    try {
      await activateSchoolYearClient();
      toast.success(`${toYear} is now the live school year`);
      router.refresh(); // re-reads server state: the live year flips, the flow resets via the [fromYear,toYear] effect
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast.error(code === 'promotion-not-run' ? 'Promote families first, then activate.' : 'Could not activate. Please try again.');
    } finally {
      setActivating(false);
    }
  }

  async function copyCalendar() {
    setCopyingCalendar(true);
    try {
      const r = await copyCalendarFromLastYearClient();
      toast.success(
        r.created.length > 0
          ? `Copied ${r.created.length} calendar date${r.created.length === 1 ? '' : 's'} into ${toYear}`
          : `Calendar already in sync for ${toYear}`,
      );
      router.refresh();
    } catch {
      toast.error('Could not copy the calendar. Please try again.');
    } finally {
      setCopyingCalendar(false);
    }
  }

  async function copyPrasad() {
    setCopyingPrasad(true);
    try {
      const r = await copyPrasadFromLastYearClient();
      toast.success(
        r.created.length > 0
          ? `Copied ${r.created.length} prasad assignment${r.created.length === 1 ? '' : 's'} into ${toYear}`
          : `Prasad already assigned for ${toYear}`,
      );
      router.refresh();
    } catch {
      toast.error('Could not copy prasad. Please try again.');
    } finally {
      setCopyingPrasad(false);
    }
  }

  async function copyTeachers() {
    setCopyingTeachers(true);
    try {
      const r = await copyTeachersFromLastYearClient();
      toast.success(
        r.filled.length > 0
          ? `Pre-filled teachers for ${r.filled.length} level${r.filled.length === 1 ? '' : 's'}`
          : `Teachers already assigned for ${toYear}`,
      );
      router.refresh();
    } catch {
      toast.error('Could not pre-fill teachers. Please try again.');
    } finally {
      setCopyingTeachers(false);
    }
  }

  async function openSevaPicker() {
    setSelectedOppIds([]);
    setDecideLater(false);
    setSevaPickerOpen(true);
    setLoadingCandidates(true);
    try {
      const items = await listSevaCandidatesClient(fromYear);
      setCandidates(items);
    } catch {
      setCandidates([]);
      toast.error("Could not load last year's seva. Please try again.");
    } finally {
      setLoadingCandidates(false);
    }
  }

  function toggleOpp(oppId: string) {
    setSelectedOppIds((prev) => (prev.includes(oppId) ? prev.filter((id) => id !== oppId) : [...prev, oppId]));
  }

  async function copySeva() {
    if (selectedOppIds.length === 0) return;
    setCopyingSeva(true);
    try {
      const r = await copySevaFromLastYearClient(selectedOppIds, decideLater);
      toast.success(`Copied ${r.created.length} seva item${r.created.length === 1 ? '' : 's'} into ${toYear}`);
      setSevaPickerOpen(false);
      router.refresh();
    } catch {
      toast.error('Could not copy seva. Please try again.');
    } finally {
      setCopyingSeva(false);
    }
  }

  const startDone = nextYearReady;
  const promoteDone = phase === 'done';

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Scoped rules that inline styles can't express: the in-flight spinner
          keyframes, subtle text-button + CTA hover states, and the responsive
          hide of the numbered step gutter on narrow phones (cards then read
          full-width with no overflow). */}
      <style>{`
        @keyframes rollover-spin { to { transform: rotate(360deg); } }
        .rollover-textbtn:not(:disabled):hover { text-decoration: underline; }
        .rollover-cta:not(:disabled) { transition: background .15s ease, transform .12s ease, box-shadow .15s ease; }
        .rollover-cta:not(:disabled):hover { box-shadow: 0 4px 14px rgba(217,102,66,0.25); }
        .rollover-cta:not(:disabled):active { transform: translateY(1px); }
        .rollover-disclosure { transition: background .15s ease; }
        .rollover-disclosure:hover { background: var(--surface2) !important; }
        .rollover-review { transition: background .15s ease, border-color .15s ease; }
        .rollover-review:hover { background: var(--accentSoft) !important; border-color: var(--accent) !important; }
        .rollover-grade-select { transition: border-color .12s ease, box-shadow .12s ease; }
        .rollover-grade-select:focus-visible { outline: none; border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accentSoft); }
        .rollover-grade-save { transition: background .15s ease, transform .12s ease, box-shadow .15s ease; }
        .rollover-grade-save:not(:disabled):hover { background: var(--accentDeep) !important; box-shadow: 0 3px 10px rgba(217,102,66,0.28); }
        .rollover-grade-save:not(:disabled):active { transform: translateY(1px); }
        @media (prefers-reduced-motion: reduce) {
          .rollover-spin, [style*="rollover-spin"] { animation-duration: 0.01ms !important; }
        }
        @media (max-width: 560px) {
          .rollover-step-gutter { display: none !important; }
        }
      `}</style>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 14, fontWeight: 500 }}
        >
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Admin · Bala Vihar</p>
        <h1 style={{ fontSize: 'clamp(26px, 7vw, 36px)', fontWeight: 400, marginTop: 6, lineHeight: 1.12, letterSpacing: '-0.01em' }}>
          School year rollover
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 600, lineHeight: 1.55 }}>
          Move every Bala Vihar family from {fromYear} into {toYear} — advance grades, re-assign levels, and keep each
          child&rsquo;s history.
        </p>

        <SchoolYearSetting
          currentYear={fromYear}
          nextYear={toYear}
          editing={editingYear}
          draft={yearDraft}
          saving={savingYear}
          onEdit={() => setEditingYear(true)}
          onDraft={setYearDraft}
          onCancel={() => {
            setYearDraft(fromYear);
            setEditingYear(false);
          }}
          onSave={saveCurrentYear}
        />

        {/* Active year → Next year status. A single banded panel so the two-step
            journey reads as one continuous arc. The two short year codes sit
            side-by-side with the arrow between them on every viewport (they fit
            without overflow even on narrow phones); the arrow recolours to ok
            once next year is ready. */}
        <div
          style={{
            marginTop: 18,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            alignItems: 'stretch',
            gap: 10,
            padding: 10,
            borderRadius: 'var(--radius, 14px)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
          }}
        >
          <YearCard label="Active year" year={fromYear} tone="neutral" />
          <div
            aria-hidden
            style={{
              alignSelf: 'center',
              color: nextYearReady ? 'var(--ok)' : 'var(--muted)',
              fontSize: 20,
              fontWeight: 600,
              transition: 'color .2s ease',
            }}
          >
            →
          </div>
          <YearCard
            label="Next year"
            year={toYear}
            tone={nextYearReady ? 'ready' : 'pending'}
            status={nextYearReady ? 'Ready' : 'Not started yet'}
          />
        </div>
      </header>

      {/* Numbered step rail — a vertical connector ties Step 1 → Step 2 so the
          flow reads as an ordered sequence, not two loose cards. The numbered
          node turns accent (active) → ok (done); the spine fills as Step 1
          completes. The gutter collapses on narrow phones so cards keep their
          width. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StepRow index={1} done={startDone} active={!startDone} spineDone={startDone}>
          <StartStep
            toYear={toYear}
            sourceLevelCount={sourceLevelCount}
            sourceOfferingCount={sourceOfferingCount}
            done={nextYearReady}
            onStarted={() => setStartedThisSession(true)}
          />
        </StepRow>

        <StepRow index={2} done={promoteDone} active={startDone && !promoteDone} last={false} spineDone={promoteDone}>
          {phase === 'done' && report ? (
            <PromoteResult
              report={report}
              onReRunPreview={(next) => {
                setReport(next);
                setPhase('preview');
              }}
            />
          ) : (
            <PromoteStep
              fromYear={fromYear}
              toYear={toYear}
              unlocked={nextYearReady}
              report={report}
              committing={committing}
              onReport={(next) => {
                setReport(next);
                setPhase('preview');
              }}
              onPromote={() => setConfirmOpen(true)}
            />
          )}
        </StepRow>

        <StepRow index={3} done={false} active={promoteDone || state.readiness.promotionRan} last>
          <YearReadinessChecklist
            readiness={state.readiness}
            onActivate={activate}
            onCopyCalendar={copyCalendar}
            activating={activating}
            copyingCalendar={copyingCalendar}
            onCopyPrasad={copyPrasad}
            copyingPrasad={copyingPrasad}
            onCopyTeachers={copyTeachers}
            copyingTeachers={copyingTeachers}
            onCopySeva={openSevaPicker}
            copyingSeva={copyingSeva}
          />
        </StepRow>
      </div>

      {confirmOpen && report && (
        <ConfirmDialog
          promoted={report.promoted}
          fromYear={fromYear}
          toYear={toYear}
          busy={committing}
          onConfirm={commit}
          onCancel={() => {
            if (!committing) setConfirmOpen(false);
          }}
        />
      )}

      <Dialog open={sevaPickerOpen} onOpenChange={(open) => { if (!copyingSeva) setSevaPickerOpen(open); }}>
        {/* `csp` is required: DialogContent portals into document.body, OUTSIDE the
            admin CspRoot, so the Setu brand tokens only resolve with `.csp` here. */}
        <DialogContent aria-describedby={undefined} className="csp" style={{ maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <DialogHeader>
            <DialogTitle>Copy seva into {toYear}</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 4, lineHeight: 1.5 }}>
            Pick which of {fromYear}&rsquo;s seva opportunities to copy into {toYear}. Nothing is copied until you choose.
          </p>

          {loadingCandidates ? (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner /> Loading last year&rsquo;s seva…
            </p>
          ) : candidates.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, lineHeight: 1.5 }}>
              No seva opportunities found for {fromYear}.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {candidates.map((c) => (
                <li key={c.oppId}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 2px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedOppIds.includes(c.oppId)}
                      onChange={() => toggleOpp(c.oppId)}
                      style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--accent)' }}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{c.title}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{formatSevaDate(c.date)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {candidates.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={decideLater}
                onChange={(e) => setDecideLater(e.target.checked)}
                style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--accent)' }}
              />
              Decide dates later (copy as drafts)
            </label>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setSevaPickerOpen(false)}
              disabled={copyingSeva}
              className="btn"
              style={{ minHeight: 40, fontSize: 13, opacity: copyingSeva ? 0.6 : 1 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={copySeva}
              disabled={copyingSeva || selectedOppIds.length === 0}
              className="btn btn--p"
              style={{
                minHeight: 40,
                fontSize: 13,
                opacity: copyingSeva || selectedOppIds.length === 0 ? 0.6 : 1,
                cursor: copyingSeva || selectedOppIds.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {copyingSeva ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Spinner /> Copying…
                </span>
              ) : (
                'Copy selected'
              )}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Render the seva opportunity's ISO date as a short Toronto-local label. Falls
 *  back to the raw string if it isn't a parseable date. */
function formatSevaDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: 'short', day: 'numeric' });
}

function SchoolYearSetting({
  currentYear,
  nextYear,
  editing,
  draft,
  saving,
  onEdit,
  onDraft,
  onCancel,
  onSave,
}: {
  currentYear: string;
  nextYear: string;
  editing: boolean;
  draft: string;
  saving: boolean;
  onEdit: () => void;
  onDraft: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <section
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 'var(--radiusSm)',
        border: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
          Current school year
        </p>
        {editing ? (
          <input
            aria-label="Current school year"
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            placeholder="2026-27"
            disabled={saving}
            style={{
              width: 132,
              marginTop: 7,
              padding: '9px 11px',
              borderRadius: 'var(--radiusSm)',
              border: '1px solid var(--line2)',
              background: 'var(--surface2)',
              color: 'var(--ink)',
              fontFamily: 'var(--mono)',
              fontSize: 16,
              fontWeight: 700,
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginTop: 4, fontFamily: 'var(--mono)' }}>{currentYear}</p>
        )}
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>
          Next year: <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{nextYear}</span>
        </p>
      </div>
      {editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="btn"
            style={{ minHeight: 38, fontSize: 13, opacity: saving ? 0.6 : 1 }}
          >
            <SetuIcon.x /> Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="btn btn--p"
            style={{ minHeight: 38, fontSize: 13, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <Spinner /> : <SetuIcon.check />} Save
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="btn"
          style={{ minHeight: 38, fontSize: 13 }}
        >
          <SetuIcon.edit /> Edit
        </button>
      )}
    </section>
  );
}

function YearCard({
  label,
  year,
  tone,
  status,
}: {
  label: string;
  year: string;
  tone: 'neutral' | 'ready' | 'pending';
  status?: string;
}) {
  const dotColor = tone === 'ready' ? 'var(--ok)' : tone === 'pending' ? 'var(--muted)' : 'transparent';
  return (
    <div
      style={{
        background: tone === 'ready' ? 'var(--setu-ok-soft)' : 'var(--surface2)',
        border: `1px solid ${tone === 'ready' ? 'var(--ok)' : 'var(--line)'}`,
        borderRadius: 'var(--radiusSm)',
        padding: '12px 14px',
        minWidth: 0,
      }}
    >
      <p style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', marginTop: 4, fontFamily: 'var(--mono)', letterSpacing: '-0.01em' }}>{year}</p>
      {status && (
        <p style={{ fontSize: 12, fontWeight: 500, color: tone === 'ready' ? 'var(--ok)' : 'var(--muted)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
          {status}
        </p>
      )}
    </div>
  );
}

/** One row of the numbered step rail: a left gutter holding a numbered node +
 *  vertical connector spine, and the card content beside it. The gutter is
 *  hidden on narrow phones (the in-card copy is self-explanatory there) so the
 *  cards keep full width and never overflow. */
function StepRow({
  index,
  done,
  active,
  last = false,
  spineDone = false,
  children,
}: {
  index: number;
  done: boolean;
  active: boolean;
  last?: boolean;
  spineDone?: boolean;
  children: React.ReactNode;
}) {
  const nodeBg = done ? 'var(--ok)' : active ? 'var(--accent)' : 'var(--surface)';
  const nodeColor = done || active ? '#fff' : 'var(--muted)';
  const nodeBorder = done ? 'var(--ok)' : active ? 'var(--accent)' : 'var(--line2)';
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* Gutter: desktop-only numbered node + spine. */}
      <div
        aria-hidden
        className="rollover-step-gutter"
        style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', width: 30 }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            background: nodeBg,
            color: nodeColor,
            border: `1.5px solid ${nodeBorder}`,
            boxShadow: active ? '0 0 0 4px var(--accentSoft)' : 'none',
            transition: 'background .2s ease, color .2s ease, border-color .2s ease, box-shadow .2s ease',
          }}
        >
          {done ? '✓' : index}
        </span>
        {!last && (
          <span
            style={{
              flex: 1,
              width: 2,
              marginTop: 6,
              borderRadius: 999,
              background: spineDone ? 'var(--ok)' : 'var(--line)',
              transition: 'background .2s ease',
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
