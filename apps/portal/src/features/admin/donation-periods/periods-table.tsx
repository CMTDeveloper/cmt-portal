'use client';

import { useState, useTransition } from 'react';
import { toast } from '@cmt/ui';
import type {
  DonationPeriodDoc,
  CreateDonationPeriodInput,
  UpdateDonationPeriodInput,
  PricingTier,
  Location,
  ProgramKey,
  PaymentSource,
} from '@cmt/shared-domain';
import { toTorontoStartOfDayISO, toTorontoEndOfDayISO, isoToTorontoDateInput } from '@/lib/toronto-date';

// Serialised shape returned by GET /api/admin/donation-periods
// (Timestamps converted to ISO strings by the route handler)
export type PeriodRow = Omit<DonationPeriodDoc, 'startDate' | 'endDate' | 'createdAt' | 'updatedAt'> & {
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
};

interface PeriodsTableProps {
  initialPeriods: PeriodRow[];
}

// Editable tier row (string fields for form inputs)
interface TierRow {
  effectiveFrom: string; // YYYY-MM-DD
  amountCAD: string;
  label: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/Toronto',
  });
}

function fmtTierShort(t: PricingTier) {
  // effectiveFrom is YYYY-MM-DD; show the month name
  const d = new Date(`${t.effectiveFrom}T12:00:00`);
  const mon = d.toLocaleDateString('en-CA', { month: 'short', timeZone: 'America/Toronto' });
  return `${mon} $${t.amountCAD}`;
}

function fmtPricing(tiers: PricingTier[]) {
  if (!tiers || tiers.length === 0) return '—';
  return tiers.map(fmtTierShort).join(' · ');
}

function tiersFromRows(rows: TierRow[]): PricingTier[] {
  return rows
    .filter((r) => r.effectiveFrom && r.amountCAD)
    .map((r) => ({ effectiveFrom: r.effectiveFrom, amountCAD: Number(r.amountCAD), label: r.label.trim() || 'Tier' }));
}

function rowsFromTiers(tiers: PricingTier[] | undefined): TierRow[] {
  if (!tiers || tiers.length === 0) {
    return [{ effectiveFrom: '', amountCAD: '500', label: 'Full year' }];
  }
  return tiers.map((t) => ({ effectiveFrom: t.effectiveFrom, amountCAD: String(t.amountCAD), label: t.label }));
}

// ─── Modal form ──────────────────────────────────────────────────────────────

interface ModalProps {
  editing: PeriodRow | null;
  onClose: () => void;
  onSaved: (period: PeriodRow) => void;
}

function PeriodModal({ editing, onClose, onSaved }: ModalProps) {
  const isEdit = editing !== null;
  const [pending, startTransition] = useTransition();

  const [programKey, setProgramKey] = useState<ProgramKey>(editing?.programKey ?? 'bala-vihar');
  const [location, setLocation] = useState<Location>(editing?.location ?? 'Brampton');
  const [periodLabel, setPeriodLabel] = useState(editing?.periodLabel ?? '');
  const [startDate, setStartDate] = useState(editing ? isoToTorontoDateInput(editing.startDate) : '');
  const [endDate, setEndDate] = useState(editing ? isoToTorontoDateInput(editing.endDate) : '');
  const [tierRows, setTierRows] = useState<TierRow[]>(rowsFromTiers(editing?.pricingTiers));
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [paymentSource, setPaymentSource] = useState<PaymentSource>(editing?.paymentSource ?? 'portal');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function updateTier(i: number, patch: Partial<TierRow>) {
    setTierRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addTier() {
    setTierRows((prev) => [...prev, { effectiveFrom: '', amountCAD: '', label: '' }]);
  }
  function removeTier(i: number) {
    setTierRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!periodLabel.trim()) e.periodLabel = 'Required';
    if (!startDate) e.startDate = 'Required';
    if (!endDate) e.endDate = 'Required';
    if (startDate && endDate && new Date(endDate) <= new Date(startDate)) e.endDate = 'Must be after start date';

    const tiers = tiersFromRows(tierRows);
    if (tiers.length === 0) {
      e.pricingTiers = 'At least one pricing tier required';
    } else {
      for (const t of tiers) {
        if (!Number.isInteger(t.amountCAD) || t.amountCAD < 1) { e.pricingTiers = 'Each tier needs a positive whole-dollar amount'; break; }
      }
      // ascending by effectiveFrom
      for (let i = 1; i < tiers.length; i++) {
        const prev = tiers[i - 1];
        const cur = tiers[i];
        if (prev && cur && cur.effectiveFrom <= prev.effectiveFrom) { e.pricingTiers = 'Tier dates must be in ascending order'; break; }
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;

    const pricingTiers = tiersFromRows(tierRows);

    startTransition(async () => {
      try {
        let res: Response;
        if (isEdit) {
          const body: UpdateDonationPeriodInput = {};
          if (periodLabel !== editing.periodLabel) body.periodLabel = periodLabel;
          if (startDate !== isoToTorontoDateInput(editing.startDate)) body.startDate = toTorontoStartOfDayISO(startDate);
          if (endDate !== isoToTorontoDateInput(editing.endDate)) body.endDate = toTorontoEndOfDayISO(endDate);
          if (JSON.stringify(pricingTiers) !== JSON.stringify(editing.pricingTiers)) body.pricingTiers = pricingTiers;
          if (enabled !== editing.enabled) body.enabled = enabled;
          if (paymentSource !== (editing.paymentSource ?? 'portal')) body.paymentSource = paymentSource;

          res = await fetch(`/api/admin/donation-periods/${editing.pid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } else {
          const body: CreateDonationPeriodInput = {
            programKey: programKey as 'bala-vihar',
            location,
            periodLabel,
            startDate: toTorontoStartOfDayISO(startDate),
            endDate: toTorontoEndOfDayISO(endDate),
            pricingTiers,
            paymentSource,
            enabled,
          };
          res = await fetch('/api/admin/donation-periods', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error(json.error ?? 'Save failed');
          return;
        }

        const json = await res.json() as { pid?: string; overlapWarning?: boolean };
        if (json.overlapWarning) {
          toast.warning('Saved — but this period overlaps with an existing enabled period for the same program + location.');
        } else {
          toast.success(isEdit ? 'Period updated.' : 'Period created.');
        }

        // Build the updated row from form state + server-returned pid (no racy refetch).
        const now = new Date().toISOString();
        if (isEdit) {
          onSaved({
            ...editing,
            periodLabel,
            startDate: toTorontoStartOfDayISO(startDate),
            endDate: toTorontoEndOfDayISO(endDate),
            pricingTiers,
            enabled,
            paymentSource,
            updatedAt: now,
          });
        } else {
          const pid = json.pid ?? `${programKey}-${location.toLowerCase()}-${periodLabel.toLowerCase().replace(/\s+/g, '-')}`;
          onSaved({
            pid,
            programKey,
            programLabel: 'Bala Vihar',
            location,
            periodLabel,
            startDate: toTorontoStartOfDayISO(startDate),
            endDate: toTorontoEndOfDayISO(endDate),
            pricingTiers,
            enabled,
            paymentSource,
            createdAt: now,
            createdBy: '',
            updatedAt: now,
            updatedBy: '',
          });
        }
        onClose();
      } catch {
        toast.error('Network error — please try again.');
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 28,
        width: '100%', maxWidth: 560, boxShadow: '0 8px 32px rgba(0,0,0,.18)',
        maxHeight: '90dvh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{isEdit ? 'Edit period' : 'New donation period'}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 20, cursor: 'pointer', color: 'var(--muted)', padding: 4 }} aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <label style={labelStyle}>
              Program
              <select value={programKey} onChange={(e) => setProgramKey(e.target.value as ProgramKey)} disabled={isEdit} style={fieldStyle}>
                <option value="bala-vihar">Bala Vihar</option>
              </select>
            </label>

            <label style={labelStyle}>
              Location
              <select value={location} onChange={(e) => setLocation(e.target.value as Location)} disabled={isEdit} style={fieldStyle}>
                {(['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as Location[]).map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              School year label
              <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="2025-26" style={fieldStyle}/>
              {errors.periodLabel && <FieldError msg={errors.periodLabel}/>}
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={labelStyle}>
                Start date
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={fieldStyle}/>
                {errors.startDate && <FieldError msg={errors.startDate}/>}
              </label>
              <label style={labelStyle}>
                End date
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={fieldStyle}/>
                {errors.endDate && <FieldError msg={errors.endDate}/>}
              </label>
            </div>

            {/* Pricing tiers (prorated by enrollment date) */}
            <div>
              <div style={{ ...labelStyle, marginBottom: 8 }}>Suggested donation by enrollment date</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                A family&apos;s suggested amount is the last tier whose date is on/before when they enroll. First tier = full year.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tierRows.map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.7fr 1.1fr auto', gap: 8, alignItems: 'center' }}>
                    <input type="date" value={row.effectiveFrom} onChange={(e) => updateTier(i, { effectiveFrom: e.target.value })} aria-label="Effective from" style={tierFieldStyle}/>
                    <input type="number" min={1} step={1} value={row.amountCAD} onChange={(e) => updateTier(i, { amountCAD: e.target.value })} placeholder="$" aria-label="Amount CAD" style={tierFieldStyle}/>
                    <input value={row.label} onChange={(e) => updateTier(i, { label: e.target.value })} placeholder="Full year" aria-label="Label" style={tierFieldStyle}/>
                    <button type="button" onClick={() => removeTier(i)} disabled={tierRows.length === 1} aria-label="Remove tier"
                      style={{ background: 'transparent', border: 0, color: tierRows.length === 1 ? 'var(--line2)' : 'var(--muted)', fontSize: 18, cursor: tierRows.length === 1 ? 'not-allowed' : 'pointer', padding: '0 4px' }}>×</button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addTier} style={{ marginTop: 8, background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                + Add tier
              </button>
              {errors.pricingTiers && <FieldError msg={errors.pricingTiers}/>}
            </div>

            <label style={labelStyle}>
              Payment source
              <select value={paymentSource} onChange={(e) => setPaymentSource(e.target.value as PaymentSource)} style={fieldStyle}>
                <option value="portal">Portal (Stripe) — families pay online here</option>
                <option value="legacy">Legacy roster — status read from the old system</option>
              </select>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block', lineHeight: 1.5 }}>
                Use “Legacy roster” for the cutover year (e.g. 2025-26) where most families already paid offline — the portal shows their real paid/pending status from the roster instead of $0. Use “Portal” for 2026-27 onward.
              </span>
            </label>

            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}/>
              Enabled (new enrollments allowed)
            </label>

          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}
              style={{ padding: '9px 18px', borderRadius: 'var(--radiusSm)', fontSize: 13, fontWeight: 500, background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--body-text)', fontFamily: 'var(--body)' }}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn btn--p" style={{ padding: '9px 22px', fontSize: 13, opacity: pending ? 0.6 : 1 }}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create period'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldError({ msg }: { msg: string }) {
  return <span style={{ fontSize: 11, color: 'var(--err)', marginTop: 4, display: 'block' }}>{msg}</span>;
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em',
};

const fieldStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 6, padding: '8px 10px',
  borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)',
  background: 'var(--bg)', fontSize: 13, color: 'var(--ink)',
  fontFamily: 'var(--body)', boxSizing: 'border-box',
};

const tierFieldStyle: React.CSSProperties = {
  padding: '7px 9px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)',
  background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--body)', boxSizing: 'border-box', width: '100%',
};

// ─── Main table ──────────────────────────────────────────────────────────────

export function PeriodsTable({ initialPeriods }: PeriodsTableProps) {
  const [periods, setPeriods] = useState<PeriodRow[]>(initialPeriods);
  const [showDisabled, setShowDisabled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PeriodRow | null>(null);

  const displayed = showDisabled ? periods : periods.filter((p) => p.enabled);

  function openCreate() { setEditing(null); setModalOpen(true); }
  function openEdit(p: PeriodRow) { setEditing(p); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); }

  function handleSaved(updated: PeriodRow) {
    setPeriods((prev) => {
      const idx = prev.findIndex((p) => p.pid === updated.pid);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [updated, ...prev];
    });
  }

  async function handleToggleEnabled(row: PeriodRow) {
    try {
      const res = await fetch(`/api/admin/donation-periods/${row.pid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      if (!res.ok) { toast.error('Toggle failed'); return; }
      setPeriods((prev) => prev.map((p) => p.pid === row.pid ? { ...p, enabled: !p.enabled } : p));
      toast.success(row.enabled ? 'Period disabled.' : 'Period enabled.');
    } catch {
      toast.error('Network error');
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', color: 'var(--body-text)' }}>
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} style={{ accentColor: 'var(--accent)' }}/>
          Show disabled periods
        </label>
        <div style={{ flex: 1 }}/>
        <button className="btn btn--p" onClick={openCreate} style={{ fontSize: 13, padding: '8px 18px' }}>+ New period</button>
      </div>

      {displayed.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          {periods.length === 0 ? 'No donation periods yet. Create one to get started.' : 'No enabled periods. Toggle "Show disabled" to see all.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)' }}>
                {['Program', 'Location', 'Year', 'Dates', 'Pricing (by join date)', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((p, i) => (
                <tr key={p.pid} style={{ borderBottom: '1px solid var(--line)', background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                  <td style={tdStyle}>{p.programLabel}</td>
                  <td style={tdStyle}>{p.location}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{p.periodLabel}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--body-text)' }}>{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</td>
                  <td style={{ ...tdStyle, color: 'var(--body-text)' }}>{fmtPricing(p.pricingTiers)}</td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: p.enabled ? 'var(--accentSoft)' : 'var(--surface2)', color: p.enabled ? 'var(--accentDeep)' : 'var(--muted)' }}>
                      {p.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(p)} style={actionBtnStyle}>Edit</button>
                    <button onClick={() => handleToggleEnabled(p)} style={{ ...actionBtnStyle, marginLeft: 6 }}>{p.enabled ? 'Disable' : 'Enable'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && <PeriodModal editing={editing} onClose={closeModal} onSaved={handleSaved}/>}
    </>
  );
}

const tdStyle: React.CSSProperties = { padding: '12px 12px', verticalAlign: 'middle' };

const actionBtnStyle: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 'var(--radiusSm)', fontSize: 12, fontWeight: 500,
  background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer',
  color: 'var(--body-text)', fontFamily: 'var(--body)',
};
