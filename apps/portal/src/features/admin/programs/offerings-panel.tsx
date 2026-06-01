'use client';

import { useState, useTransition, useEffect } from 'react';
import { toast } from '@cmt/ui';
import type {
  OfferingDoc,
  CreateOfferingInput,
  UpdateOfferingInput,
  PricingTier,
  Location,
  PaymentSource,
} from '@cmt/shared-domain';
import { LOCATIONS } from '@cmt/shared-domain';
import { toTorontoStartOfDayISO, toTorontoEndOfDayISO, isoToTorontoDateInput } from '@/lib/toronto-date';

// ─── responsive hook ─────────────────────────────────────────────────────────

function useIsNarrow(breakpoint = 480) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return narrow;
}

// Serialised shape from GET /api/admin/offerings (Timestamps → ISO strings)
export type OfferingRow = Omit<OfferingDoc, 'startDate' | 'endDate' | 'createdAt' | 'updatedAt'> & {
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
};

interface OfferingsPanelProps {
  programKey: string;
  initialOfferings: OfferingRow[];
}

// Editable tier row (string fields for form inputs)
interface TierRow {
  effectiveFrom: string;
  amountCAD: string;
  label: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/Toronto',
  });
}

function fmtTierShort(t: PricingTier) {
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

/** Shift a YYYY-MM-DD date by +1 year */
function shiftYearYmd(ymd: string): string {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00`);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Shift an ISO datetime string by +1 year */
function shiftYearIso(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}

// ─── Modal form ──────────────────────────────────────────────────────────────

interface ModalProps {
  programKey: string;
  editing: OfferingRow | null;
  /** When set, modal is opened in "duplicate" mode with pre-filled values */
  duplicateFrom: OfferingRow | null;
  onClose: () => void;
  onSaved: (offering: OfferingRow) => void;
}

function OfferingModal({ programKey, editing, duplicateFrom, onClose, onSaved }: ModalProps) {
  const isEdit = editing !== null;
  const prefill = duplicateFrom ?? editing;
  const [pending, startTransition] = useTransition();
  const isNarrow = useIsNarrow(480);

  // In duplicate mode, pre-fill with +1 year shifted dates and blank term label
  const isDuplicate = !isEdit && duplicateFrom !== null;

  const [location, setLocation] = useState<Location | null>(prefill?.location ?? null);
  const [termLabel, setTermLabel] = useState(() => {
    if (isDuplicate) return ''; // blank for admin to fill in
    return editing?.termLabel ?? '';
  });
  const [startDate, setStartDate] = useState(() => {
    if (isDuplicate && duplicateFrom?.startDate) return isoToTorontoDateInput(shiftYearIso(duplicateFrom.startDate));
    if (editing) return isoToTorontoDateInput(editing.startDate);
    return '';
  });
  const [endDate, setEndDate] = useState(() => {
    if (isDuplicate && duplicateFrom?.endDate) return isoToTorontoDateInput(shiftYearIso(duplicateFrom.endDate));
    if (editing?.endDate) return isoToTorontoDateInput(editing.endDate);
    return '';
  });
  const [tierRows, setTierRows] = useState<TierRow[]>(() => {
    const tiers = prefill?.pricingTiers;
    if (isDuplicate && tiers && tiers.length > 0) {
      // Shift tier effectiveFrom dates by +1 year
      return tiers.map((t) => ({
        effectiveFrom: shiftYearYmd(t.effectiveFrom),
        amountCAD: String(t.amountCAD),
        label: t.label,
      }));
    }
    return rowsFromTiers(editing?.pricingTiers);
  });
  const [enabled, setEnabled] = useState(editing?.enabled ?? prefill?.enabled ?? true);
  const [paymentSource, setPaymentSource] = useState<PaymentSource>(editing?.paymentSource ?? prefill?.paymentSource ?? 'portal');
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
    if (!termLabel.trim()) e.termLabel = 'Required';
    if (!startDate) e.startDate = 'Required';
    if (!endDate) e.endDate = 'Required';
    if (startDate && endDate && new Date(endDate) <= new Date(startDate)) e.endDate = 'Must be after start date';
    const tiers = tiersFromRows(tierRows);
    if (tiers.length > 0) {
      for (const t of tiers) {
        if (!Number.isInteger(t.amountCAD) || t.amountCAD < 1) { e.pricingTiers = 'Each tier needs a positive whole-dollar amount'; break; }
      }
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
          const body: UpdateOfferingInput = {};
          if (termLabel !== editing.termLabel) body.termLabel = termLabel;
          if (startDate !== isoToTorontoDateInput(editing.startDate)) body.startDate = toTorontoStartOfDayISO(startDate);
          const editEndDate = editing.endDate ? isoToTorontoDateInput(editing.endDate) : '';
          if (endDate !== editEndDate) body.endDate = endDate ? toTorontoEndOfDayISO(endDate) : null;
          if (JSON.stringify(pricingTiers) !== JSON.stringify(editing.pricingTiers)) body.pricingTiers = pricingTiers;
          if (enabled !== editing.enabled) body.enabled = enabled;
          if (paymentSource !== (editing.paymentSource ?? 'portal')) body.paymentSource = paymentSource;
          res = await fetch(`/api/admin/offerings/${editing.oid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } else {
          const body: CreateOfferingInput = {
            programKey,
            location,
            termLabel,
            termType: 'term',
            startDate: toTorontoStartOfDayISO(startDate),
            endDate: toTorontoEndOfDayISO(endDate),
            pricingTiers,
            paymentSource,
            enabled,
          };
          res = await fetch('/api/admin/offerings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error((json as { error?: string }).error ?? 'Save failed');
          return;
        }

        const json = await res.json() as { oid?: string; overlapWarning?: boolean };
        if (json.overlapWarning) {
          toast.warning('Saved — but this offering overlaps with an existing enabled offering for the same program + location.');
        } else {
          toast.success(isEdit ? 'Offering updated.' : 'Offering created.');
        }

        const now = new Date().toISOString();
        if (isEdit) {
          onSaved({
            ...editing,
            termLabel,
            startDate: toTorontoStartOfDayISO(startDate),
            endDate: endDate ? toTorontoEndOfDayISO(endDate) : null,
            pricingTiers,
            enabled,
            paymentSource,
            updatedAt: now,
          });
        } else {
          const oid = json.oid ?? `${programKey}-${location?.toLowerCase() ?? 'all'}-${termLabel.toLowerCase().replace(/\s+/g, '-')}`;
          onSaved({
            oid,
            programKey,
            programLabel: '',
            location,
            termLabel,
            termType: 'term',
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
      className="csp"
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
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>
            {isDuplicate ? 'Duplicate offering' : isEdit ? 'Edit offering' : 'New offering'}
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 20, cursor: 'pointer', color: 'var(--muted)', padding: 4 }} aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <label style={labelStyle}>
              Location (optional)
              <select
                value={location ?? ''}
                onChange={(e) => setLocation(e.target.value ? e.target.value as Location : null)}
                disabled={isEdit}
                style={fieldStyle}
              >
                <option value="">None (location-less)</option>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>

            <label style={labelStyle}>
              Term label
              <input value={termLabel} onChange={(e) => setTermLabel(e.target.value)} placeholder="2025-26" style={fieldStyle} />
              {errors.termLabel && <FieldError msg={errors.termLabel} />}
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={labelStyle}>
                Start date
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={fieldStyle} />
                {errors.startDate && <FieldError msg={errors.startDate} />}
              </label>
              <label style={labelStyle}>
                End date
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={fieldStyle} />
                {errors.endDate && <FieldError msg={errors.endDate} />}
              </label>
            </div>

            {/* Pricing tiers */}
            <div>
              <div style={{ ...labelStyle, marginBottom: 8 }}>Suggested donation by enrollment date</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                A family&apos;s suggested amount is the last tier whose date is on/before when they enroll. Leave empty for free programs.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tierRows.map((row, i) => (
                  isNarrow ? (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto auto', gap: 8, alignItems: 'center' }}>
                      <input type="date" value={row.effectiveFrom} onChange={(e) => updateTier(i, { effectiveFrom: e.target.value })} aria-label="Effective from" style={tierFieldStyle} />
                      <input type="number" min={1} step={1} value={row.amountCAD} onChange={(e) => updateTier(i, { amountCAD: e.target.value })} placeholder="$" aria-label="Amount CAD" style={tierFieldStyle} />
                      <input value={row.label} onChange={(e) => updateTier(i, { label: e.target.value })} placeholder="Full year" aria-label="Label" style={tierFieldStyle} />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => removeTier(i)} disabled={tierRows.length === 1} aria-label="Remove tier"
                          style={{ background: 'transparent', border: 0, color: tierRows.length === 1 ? 'var(--line2)' : 'var(--muted)', fontSize: 18, cursor: tierRows.length === 1 ? 'not-allowed' : 'pointer', padding: '0 4px' }}>×</button>
                      </div>
                    </div>
                  ) : (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.7fr 1.1fr auto', gap: 8, alignItems: 'center' }}>
                      <input type="date" value={row.effectiveFrom} onChange={(e) => updateTier(i, { effectiveFrom: e.target.value })} aria-label="Effective from" style={tierFieldStyle} />
                      <input type="number" min={1} step={1} value={row.amountCAD} onChange={(e) => updateTier(i, { amountCAD: e.target.value })} placeholder="$" aria-label="Amount CAD" style={tierFieldStyle} />
                      <input value={row.label} onChange={(e) => updateTier(i, { label: e.target.value })} placeholder="Full year" aria-label="Label" style={tierFieldStyle} />
                      <button type="button" onClick={() => removeTier(i)} disabled={tierRows.length === 1} aria-label="Remove tier"
                        style={{ background: 'transparent', border: 0, color: tierRows.length === 1 ? 'var(--line2)' : 'var(--muted)', fontSize: 18, cursor: tierRows.length === 1 ? 'not-allowed' : 'pointer', padding: '0 4px' }}>×</button>
                    </div>
                  )
                ))}
              </div>
              <button type="button" onClick={addTier} style={{ marginTop: 8, background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                + Add tier
              </button>
              {errors.pricingTiers && <FieldError msg={errors.pricingTiers} />}
            </div>

            <label style={labelStyle}>
              Payment source
              <select value={paymentSource} onChange={(e) => setPaymentSource(e.target.value as PaymentSource)} style={fieldStyle}>
                <option value="portal">Portal (Stripe) — families pay online here</option>
                <option value="legacy">Legacy roster — status read from the old system</option>
              </select>
            </label>

            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              Enabled (new enrollments allowed)
            </label>

          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={pending} className="btn btn--p" style={{ padding: '9px 22px', fontSize: 13, opacity: pending ? 0.6 : 1 }}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : isDuplicate ? 'Create offering' : 'Create offering'}
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
const cancelBtnStyle: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 'var(--radiusSm)', fontSize: 13, fontWeight: 500,
  background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer',
  color: 'var(--body-text)', fontFamily: 'var(--body)',
};
const tdStyle: React.CSSProperties = { padding: '12px 12px', verticalAlign: 'middle' };
const cardKeyStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
  letterSpacing: '.06em', whiteSpace: 'nowrap', paddingTop: 1,
};
const actionBtnStyle: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 'var(--radiusSm)', fontSize: 12, fontWeight: 500,
  background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer',
  color: 'var(--body-text)', fontFamily: 'var(--body)',
};

// ─── Main panel ──────────────────────────────────────────────────────────────

export function OfferingsPanel({ programKey, initialOfferings }: OfferingsPanelProps) {
  const [offerings, setOfferings] = useState<OfferingRow[]>(initialOfferings);
  const [showDisabled, setShowDisabled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OfferingRow | null>(null);
  const [duplicateFrom, setDuplicateFrom] = useState<OfferingRow | null>(null);

  const displayed = showDisabled ? offerings : offerings.filter((o) => o.enabled);

  function openCreate() { setEditing(null); setDuplicateFrom(null); setModalOpen(true); }
  function openEdit(o: OfferingRow) { setEditing(o); setDuplicateFrom(null); setModalOpen(true); }
  function openDuplicate(o: OfferingRow) { setEditing(null); setDuplicateFrom(o); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); setDuplicateFrom(null); }

  function handleSaved(updated: OfferingRow) {
    setOfferings((prev) => {
      const idx = prev.findIndex((o) => o.oid === updated.oid);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [updated, ...prev];
    });
  }

  async function handleToggleEnabled(row: OfferingRow) {
    try {
      const res = await fetch(`/api/admin/offerings/${row.oid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      if (!res.ok) { toast.error('Toggle failed'); return; }
      setOfferings((prev) => prev.map((o) => o.oid === row.oid ? { ...o, enabled: !o.enabled } : o));
      toast.success(row.enabled ? 'Offering disabled.' : 'Offering enabled.');
    } catch {
      toast.error('Network error');
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', color: 'var(--body-text)' }}>
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          Show disabled offerings
        </label>
        <div style={{ flex: 1 }} />
        <button className="btn btn--p" onClick={openCreate} style={{ fontSize: 13, padding: '8px 18px' }}>+ New offering</button>
      </div>

      {displayed.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          {offerings.length === 0 ? 'No offerings yet. Create one to get started.' : 'No enabled offerings. Toggle "Show disabled" to see all.'}
        </div>
      ) : (
        <>
          {/* Mobile: stacked rows */}
          <div className="block md:hidden">
            {displayed.map((o, i) => (
              <div key={o.oid} style={{ padding: '16px 0', borderTop: i > 0 ? '1px solid var(--line)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{o.termLabel}</span>
                      {o.location && (
                        <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--line2)' }}>{o.location}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{o.termType}</div>
                  </div>
                  <span style={{ flex: '0 0 auto', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: o.enabled ? 'var(--accentSoft)' : 'var(--surface2)', color: o.enabled ? 'var(--accentDeep)' : 'var(--muted)' }}>
                    {o.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13 }}>
                  <span style={cardKeyStyle}>Dates</span>
                  <span style={{ color: 'var(--body-text)' }}>{fmtDate(o.startDate)} – {fmtDate(o.endDate)}</span>
                  <span style={cardKeyStyle}>Pricing</span>
                  <span style={{ color: 'var(--body-text)' }}>{fmtPricing(o.pricingTiers)}</span>
                  <span style={cardKeyStyle}>Payment</span>
                  <span style={{ color: 'var(--body-text)' }}>{(o.paymentSource ?? 'portal') === 'legacy' ? 'Legacy roster' : 'Portal (Stripe)'}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => openEdit(o)} style={{ ...actionBtnStyle, flex: 1, textAlign: 'center', padding: '9px 12px' }}>Edit</button>
                  <button onClick={() => openDuplicate(o)} style={{ ...actionBtnStyle, flex: 1, textAlign: 'center', padding: '9px 12px' }} aria-label="Duplicate">Duplicate</button>
                  <button onClick={() => handleToggleEnabled(o)} style={{ ...actionBtnStyle, flex: 1, textAlign: 'center', padding: '9px 12px' }}>{o.enabled ? 'Disable' : 'Enable'}</button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: full table */}
          <div className="hidden md:block" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)' }}>
                  {['Location', 'Term', 'Dates', 'Pricing (by join date)', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((o, i) => (
                  <tr key={o.oid} style={{ borderBottom: '1px solid var(--line)', background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                    <td style={tdStyle}>{o.location ?? '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{o.termLabel}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--body-text)' }}>{fmtDate(o.startDate)} – {fmtDate(o.endDate)}</td>
                    <td style={{ ...tdStyle, color: 'var(--body-text)' }}>{fmtPricing(o.pricingTiers)}</td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: o.enabled ? 'var(--accentSoft)' : 'var(--surface2)', color: o.enabled ? 'var(--accentDeep)' : 'var(--muted)' }}>
                        {o.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button onClick={() => openEdit(o)} style={actionBtnStyle}>Edit</button>
                      <button onClick={() => openDuplicate(o)} style={{ ...actionBtnStyle, marginLeft: 6 }} aria-label="Duplicate">Duplicate</button>
                      <button onClick={() => handleToggleEnabled(o)} style={{ ...actionBtnStyle, marginLeft: 6 }}>{o.enabled ? 'Disable' : 'Enable'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modalOpen && (
        <OfferingModal
          programKey={programKey}
          editing={editing}
          duplicateFrom={duplicateFrom}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
