'use client';

import { useEffect, useState } from 'react';
import { SetuLogo, SetuIcon } from '@cmt/ui';
import type {
  EnrollmentReport,
  AttendanceReport,
  DonationsReport,
} from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import { ReportExportButton as CheckInExportButton } from '@/features/check-in/admin';
import { fetchReport } from './reports-client';
import { ReportExportButton } from './report-export-button';

// ── Small presentational atoms (module-scope — never nested components) ─────────

function StatChip({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'ok' | 'warn' }) {
  const fg = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink)';
  return (
    <span
      style={{
        display: 'inline-flex', flexDirection: 'column', gap: 1,
        padding: '7px 13px', borderRadius: 'var(--radius)',
        background: 'var(--surface2)', border: '1px solid var(--line)',
        minWidth: 78,
      }}
    >
      <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: fg, fontFeatureSettings: '"tnum"' }}>{value}</span>
      <span style={{ fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>{label}</span>
    </span>
  );
}

function PaymentChip({ kind, value }: { kind: 'paid' | 'outstanding'; value: number }) {
  const ok = kind === 'paid';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 99,
        background: 'var(--accentSoft)', color: ok ? 'var(--ok)' : 'var(--warn)', whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />
      <span style={{ fontFeatureSettings: '"tnum"' }}>{value.toLocaleString()}</span> {ok ? 'paid' : 'outstanding'}
    </span>
  );
}

// A compact rate bar — at-a-glance attendance health without a chart lib.
function RateCell({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const tone = pct >= 85 ? 'var(--ok)' : pct >= 65 ? 'var(--warn)' : 'var(--err)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }}>
      <span aria-hidden style={{ width: 34, height: 5, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', flex: '0 0 auto' }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: tone, borderRadius: 99 }} />
      </span>
      <span style={{ fontWeight: 600, color: tone, fontFeatureSettings: '"tnum"', minWidth: 34, textAlign: 'right' }}>{pct}%</span>
    </span>
  );
}

// Generic compact summary table. Numeric columns right-align with tabular nums.
type Col = { key: string; label: string; numeric?: boolean; render?: (row: Record<string, unknown>) => React.ReactNode };
function SummaryTable({ caption, cols, rows }: { caption: string; cols: Col[]; rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, marginBottom: 7 }}>
        {caption}
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>No data in range.</p>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: cols.length > 3 ? 380 : 0 }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    style={{
                      textAlign: c.numeric ? 'right' : 'left',
                      padding: '8px 12px', fontSize: 11, fontWeight: 600,
                      letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)',
                      background: 'var(--surface2)', whiteSpace: 'nowrap',
                      borderBottom: '1px solid var(--line)',
                    }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={(row['__key'] as string) ?? i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        textAlign: c.numeric ? 'right' : 'left',
                        padding: '9px 12px', color: 'var(--ink)',
                        fontFeatureSettings: c.numeric ? '"tnum"' : undefined,
                        whiteSpace: c.numeric ? 'nowrap' : 'normal',
                      }}
                    >
                      {c.render ? c.render(row) : String(row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CardShell({
  testId, icon, title, subtitle, children, headerAside,
}: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  headerAside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      style={{
        background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
          padding: '16px 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface2)',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 10, flex: '0 0 auto',
            background: 'var(--accentSoft)', color: 'var(--accentDeep)',
          }}
        >
          {icon}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{title}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '2px 0 0' }}>{subtitle}</p>
        </div>
        {headerAside}
      </div>
      <div className="col" style={{ gap: 16, padding: '16px 18px' }}>{children}</div>
    </section>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        padding: '10px 14px', background: 'var(--accentSoft)', border: '1px solid var(--err)',
        borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--err)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <SetuIcon.warn color="var(--err)" /> {children}
    </div>
  );
}

function LoadingNote({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }} aria-busy="true">{children}</p>;
}

// ── Cards (each owns its own fetch-on-mount; fails independently) ───────────────

function EnrollmentCard() {
  const [data, setData] = useState<EnrollmentReport | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    fetchReport('enrollment')
      .then((r) => { if (alive) { setData(r); setState('ok'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, []);

  return (
    <CardShell
      testId="report-card-enrollment"
      icon={<SetuIcon.people />}
      title="Enrollment"
      subtitle="Active families and members, by program and level."
    >
      {state === 'loading' && <LoadingNote>Loading enrollment headcounts…</LoadingNote>}
      {state === 'error' && <ErrorNote>Couldn’t load enrollment. Please try again.</ErrorNote>}
      {state === 'ok' && data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <StatChip label="Active enrollments" value={data.totalActiveEnrollments.toLocaleString()} />
            <StatChip label="Members" value={data.totalMembers.toLocaleString()} />
            <StatChip label="Programs" value={data.byProgram.length.toLocaleString()} />
          </div>
          <SummaryTable
            caption="By program"
            cols={[
              { key: 'programLabel', label: 'Program' },
              { key: 'families', label: 'Families', numeric: true },
              { key: 'members', label: 'Members', numeric: true },
            ]}
            rows={data.byProgram.map((p) => ({ __key: p.programKey, programLabel: p.programLabel, families: p.families, members: p.members }))}
          />
          <SummaryTable
            caption="By level"
            cols={[
              { key: 'levelName', label: 'Level' },
              { key: 'members', label: 'Members', numeric: true },
            ]}
            rows={data.byLevel.map((l) => ({ __key: l.levelId, levelName: l.levelName, members: l.members }))}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <ReportExportButton kind="enrollment" filename="enrollment-people" label="Export people CSV" />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>One row per family member.</span>
          </div>
        </>
      )}
    </CardShell>
  );
}

// Compute a default 12-month range, client-side (the API also fills defaults).
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { from: ymd(from), to: ymd(to) };
}

function DateInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label htmlFor={id} style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>{label}</span>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring"
        style={{
          minHeight: 44, padding: '0 12px', fontSize: 13,
          border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          background: 'var(--surface)', color: 'var(--ink)', outline: 'none',
          fontFeatureSettings: '"tnum"', boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function AttendanceCard() {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<AttendanceReport | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  // Re-fetch whenever the range changes.
  useEffect(() => {
    let alive = true;
    setState('loading');
    fetchReport('attendance', { from, to })
      .then((r) => { if (alive) { setData(r); setState('ok'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [from, to]);

  const attCols: Col[] = [
    { key: 'present', label: 'Present', numeric: true },
    { key: 'absent', label: 'Absent', numeric: true },
    { key: 'late', label: 'Late', numeric: true },
    { key: 'total', label: 'Total', numeric: true },
    { key: 'rate', label: 'Rate', numeric: true, render: (r) => <RateCell rate={r['rate'] as number} /> },
  ];

  return (
    <CardShell
      testId="report-card-attendance"
      icon={<SetuIcon.check />}
      title="Attendance"
      subtitle="Present / absent / late rollup over a date range."
      headerAside={
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <DateInput id="att-from" label="From" value={from} onChange={setFrom} />
          <DateInput id="att-to" label="To" value={to} onChange={setTo} />
        </div>
      }
    >
      {state === 'loading' && <LoadingNote>Loading attendance…</LoadingNote>}
      {state === 'error' && <ErrorNote>Couldn’t load attendance. Please try again.</ErrorNote>}
      {state === 'ok' && data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <StatChip label="Marks in range" value={data.totalEvents.toLocaleString()} />
            <StatChip label="Levels" value={data.byLevel.length.toLocaleString()} />
          </div>
          <SummaryTable
            caption="By level"
            cols={[{ key: 'levelName', label: 'Level' }, ...attCols]}
            rows={data.byLevel.map((l) => ({ __key: l.levelId, levelName: l.levelName, present: l.present, absent: l.absent, late: l.late, total: l.total, rate: l.rate }))}
          />
          <SummaryTable
            caption="By program"
            cols={[{ key: 'programLabel', label: 'Program' }, ...attCols]}
            rows={data.byProgram.map((p) => ({ __key: p.programKey, programLabel: p.programLabel, present: p.present, absent: p.absent, late: p.late, total: p.total, rate: p.rate }))}
          />
          <ReportExportButton kind="attendance" filename="attendance-summary" params={{ from, to }} />
        </>
      )}
    </CardShell>
  );
}

function moneyCAD(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function DonationsCard() {
  const [data, setData] = useState<DonationsReport | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    fetchReport('donations')
      .then((r) => { if (alive) { setData(r); setState('ok'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, []);

  return (
    <CardShell
      testId="report-card-donations"
      icon={<SetuIcon.receipt />}
      title="Donations"
      subtitle="Completed contributions by period and program. Admin only."
    >
      {state === 'loading' && <LoadingNote>Loading donations…</LoadingNote>}
      {state === 'error' && <ErrorNote>Couldn’t load donations. Please try again.</ErrorNote>}
      {state === 'ok' && data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <StatChip label="Total completed" value={moneyCAD(data.totalCompletedCAD)} tone="ok" />
            <PaymentChip kind="paid" value={data.paidFamilies} />
            <PaymentChip kind="outstanding" value={data.outstandingFamilies} />
          </div>
          <SummaryTable
            caption="By donation period"
            cols={[
              { key: 'label', label: 'Period' },
              { key: 'programLabel', label: 'Program' },
              { key: 'completedCAD', label: 'Completed', numeric: true, render: (r) => moneyCAD(r['completedCAD'] as number) },
              { key: 'completedCount', label: 'Count', numeric: true },
            ]}
            rows={data.byPeriod.map((p) => ({ __key: p.pid, label: p.label, programLabel: p.programLabel, completedCAD: p.completedCAD, completedCount: p.completedCount }))}
          />
          <SummaryTable
            caption="By program"
            cols={[
              { key: 'programLabel', label: 'Program' },
              { key: 'completedCAD', label: 'Completed', numeric: true, render: (r) => moneyCAD(r['completedCAD'] as number) },
              { key: 'completedCount', label: 'Count', numeric: true },
            ]}
            rows={data.byProgram.map((p) => ({ __key: p.programKey, programLabel: p.programLabel, completedCAD: p.completedCAD, completedCount: p.completedCount }))}
          />
          <ReportExportButton kind="donations" filename="donations-summary" />
          <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
            Totals are best-effort — accounting@ remains the settlement source of truth (no Stripe webhook).
            All-time, by donation period.
          </p>
        </>
      )}
    </CardShell>
  );
}

function LegacyCard() {
  return (
    <CardShell
      testId="report-card-legacy"
      icon={<SetuIcon.dl />}
      title="Legacy check-in"
      subtitle="Door-app CSV exports from the standalone kiosk."
    >
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, margin: 0 }}>
        Legacy door-app exports
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <CheckInExportButton kind="check-ins" label="Export check-ins CSV" />
        <CheckInExportButton kind="guests" label="Export guests CSV" />
      </div>
    </CardShell>
  );
}

// ── Shared body (rendered into both mobile + desktop branches) ──────────────────

function HubBody({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="col" style={{ gap: 16, maxWidth: 760 }}>
      <EnrollmentCard />
      <AttendanceCard />
      {isAdmin && <DonationsCard />}
      {isAdmin && <LegacyCard />}
    </div>
  );
}

export function ReportsHub({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
      {/* Mobile — own CspRoot + 90px bottom padding for the fixed WelcomeMobileNav. */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div style={{ marginBottom: 20 }}>
              <SetuLogo size={18} />
            </div>
            <header style={{ marginBottom: 18 }}>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em' }}>Reports</h1>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                Enrollment, attendance, and donation summaries — view on screen or export to CSV.
              </p>
            </header>
            <HubBody isAdmin={isAdmin} />
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns the sidebar + main wrapper. */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>Reports</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
            Enrollment, attendance, and donation summaries — view on screen or export to CSV.
          </p>
        </header>
        <HubBody isAdmin={isAdmin} />
      </div>
    </>
  );
}
