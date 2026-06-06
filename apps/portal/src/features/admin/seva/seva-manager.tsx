'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { SetuIcon, toast } from '@cmt/ui';
import {
  createOpportunity,
  listOpportunities,
  saveRequirement,
  updateOpportunity,
  type SerializedOpportunity,
  type SevaRequirement,
} from './opportunities-client';

interface SevaManagerProps {
  initialRequirement: SevaRequirement;
  initialOpportunities: SerializedOpportunity[];
  canEditRequirement: boolean;
}

// ─── shared styles ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.07em',
};
const fieldStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 7,
  padding: '11px 13px',
  borderRadius: 'var(--radiusSm)',
  border: '1px solid var(--line2)',
  background: 'var(--surface)',
  fontSize: 15,
  color: 'var(--ink)',
  fontFamily: 'var(--body)',
  boxSizing: 'border-box',
};
const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  fontWeight: 600,
};
const sectionLabelStyle: React.CSSProperties = {
  ...labelStyle,
  letterSpacing: '.09em',
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Toronto',
  });
}

/** Convert an ISO date string to the 'YYYY-MM-DD' a <input type="date"> expects, in Toronto. */
function isoToDateInput(iso: string): string {
  // en-CA gives YYYY-MM-DD which matches the date-input format.
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function capacityLabel(capacity: number | null): string {
  return capacity == null ? 'Unlimited spots' : `${capacity} spot${capacity === 1 ? '' : 's'}`;
}

function FieldError({ msg }: { msg: string }) {
  return <span style={{ fontSize: 12, color: 'var(--err)', marginTop: 5, display: 'block' }}>{msg}</span>;
}

/** A thin middot separator between inline metadata items. */
function Dot() {
  return <span aria-hidden style={{ color: 'var(--line2)' }}>·</span>;
}

// Editable opportunity form values (string-backed for the inputs).
interface OppFormState {
  title: string;
  date: string;
  defaultHours: string;
  capacity: string;
  location: string;
  description: string;
}

function emptyForm(): OppFormState {
  return { title: '', date: '', defaultHours: '1', capacity: '', location: '', description: '' };
}

function formFromOpp(o: SerializedOpportunity): OppFormState {
  return {
    title: o.title,
    date: isoToDateInput(o.date),
    defaultHours: String(o.defaultHours),
    capacity: o.capacity == null ? '' : String(o.capacity),
    location: o.location,
    description: o.description,
  };
}

// ─── main component ────────────────────────────────────────────────────────────

export function SevaManager({
  initialRequirement,
  initialOpportunities,
  canEditRequirement,
}: SevaManagerProps) {
  const [requirement, setRequirement] = useState<SevaRequirement>(initialRequirement);
  const [opportunities, setOpportunities] = useState<SerializedOpportunity[]>(initialOpportunities);

  // Requirement edit state
  const [editingReq, setEditingReq] = useState(false);
  const [reqYear, setReqYear] = useState(initialRequirement.currentSevaYear ?? '');
  const [reqHours, setReqHours] = useState(String(initialRequirement.hoursPerYear));
  const [savingReq, startReqTransition] = useTransition();

  // Create state
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<OppFormState>(emptyForm);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [savingCreate, startCreateTransition] = useTransition();

  // Edit state (one row at a time)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<OppFormState>(emptyForm);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [closingId, setClosingId] = useState<string | null>(null);
  const [savingEdit, startEditTransition] = useTransition();

  const hasYear = requirement.currentSevaYear != null && requirement.currentSevaYear !== '';

  // ── requirement save ──
  function openReqEdit() {
    setReqYear(requirement.currentSevaYear ?? '');
    setReqHours(String(requirement.hoursPerYear));
    setEditingReq(true);
  }
  function submitReq() {
    const year = reqYear.trim();
    const hours = Number(reqHours);
    if (!year) {
      toast.error('Enter a seva year, e.g. 2025-26');
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error('Hours must be greater than 0');
      return;
    }
    startReqTransition(async () => {
      const res = await saveRequirement({ hoursPerYear: hours, currentSevaYear: year });
      if (!res.ok) {
        toast.error(res.error ?? 'Save failed');
        return;
      }
      setRequirement({ hoursPerYear: hours, currentSevaYear: year });
      setEditingReq(false);
      toast.success('Seva requirement saved');
    });
  }

  // ── create ──
  function validateForm(form: OppFormState): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Required';
    if (!form.date) e.date = 'Required';
    if (!(Number(form.defaultHours) > 0)) e.defaultHours = 'Must be greater than 0';
    return e;
  }

  function submitCreate() {
    const e = validateForm(createForm);
    setCreateErrors(e);
    if (Object.keys(e).length > 0) return;

    // Conditionally-spread optional fields so we never send `undefined`
    // (exactOptionalPropertyTypes); blank capacity = unlimited (omit).
    const input: Parameters<typeof createOpportunity>[0] = {
      title: createForm.title.trim(),
      date: createForm.date,
      defaultHours: Number(createForm.defaultHours),
    };
    if (createForm.location.trim()) input.location = createForm.location.trim();
    if (createForm.description.trim()) input.description = createForm.description.trim();
    if (createForm.capacity.trim()) input.capacity = Number(createForm.capacity);

    startCreateTransition(async () => {
      const res = await createOpportunity(input);
      if (!res.ok) {
        toast.error(res.error === 'seva-year-not-set' ? 'Set a seva year first' : (res.error ?? 'Save failed'));
        return;
      }
      const fresh = await listOpportunities();
      setOpportunities(fresh);
      setCreating(false);
      setCreateForm(emptyForm());
      setCreateErrors({});
      toast.success('Opportunity posted');
    });
  }

  // ── edit ──
  function openEdit(o: SerializedOpportunity) {
    setEditingId(o.oppId);
    setEditForm(formFromOpp(o));
    setEditErrors({});
  }
  function submitEdit(oppId: string) {
    const e = validateForm(editForm);
    setEditErrors(e);
    if (Object.keys(e).length > 0) return;

    const patch: Record<string, unknown> = {
      title: editForm.title.trim(),
      date: editForm.date,
      defaultHours: Number(editForm.defaultHours),
      location: editForm.location.trim(),
      description: editForm.description.trim(),
      capacity: editForm.capacity.trim() ? Number(editForm.capacity) : null,
    };

    startEditTransition(async () => {
      const res = await updateOpportunity(oppId, patch);
      if (!res.ok) {
        toast.error(res.error ?? 'Save failed');
        return;
      }
      const fresh = await listOpportunities();
      setOpportunities(fresh);
      setEditingId(null);
      toast.success('Opportunity updated');
    });
  }

  // ── close ──
  async function closeOpp(oppId: string) {
    if (closingId) return;
    if (!confirm('Close this opportunity? Families will no longer be able to sign up for it.')) return;
    setClosingId(oppId);
    const res = await updateOpportunity(oppId, { status: 'closed' });
    setClosingId(null);
    if (!res.ok) {
      toast.error(res.error ?? 'Close failed');
      return;
    }
    setOpportunities((prev) => prev.map((o) => (o.oppId === oppId ? { ...o, status: 'closed' } : o)));
    toast.success('Opportunity closed');
  }

  // ── shared opportunity-form fields (rendered as a function, never a nested
  //    component — declaring a component inside another remounts it on every
  //    keystroke and steals input focus). ──
  function renderOppFields(
    form: OppFormState,
    setForm: React.Dispatch<React.SetStateAction<OppFormState>>,
    errors: Record<string, string>,
    idPrefix: string,
  ) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={labelStyle} htmlFor={`${idPrefix}-title`}>
          Title
          <input
            id={`${idPrefix}-title`}
            aria-label={idPrefix === 'create' ? 'Title' : 'Edit title'}
            value={form.title}
            onChange={(ev) => setForm((f) => ({ ...f, title: ev.target.value }))}
            placeholder="Diwali hall setup"
            style={fieldStyle}
          />
          {errors.title && <FieldError msg={errors.title} />}
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <label style={labelStyle} htmlFor={`${idPrefix}-date`}>
            Date
            <input
              id={`${idPrefix}-date`}
              aria-label={idPrefix === 'create' ? 'Date' : 'Edit date'}
              type="date"
              value={form.date}
              onChange={(ev) => setForm((f) => ({ ...f, date: ev.target.value }))}
              style={fieldStyle}
            />
            {errors.date && <FieldError msg={errors.date} />}
          </label>
          <label style={labelStyle} htmlFor={`${idPrefix}-hours`}>
            Default hours
            <input
              id={`${idPrefix}-hours`}
              aria-label={idPrefix === 'create' ? 'Default hours' : 'Edit default hours'}
              type="number"
              min={0.5}
              step={0.5}
              value={form.defaultHours}
              onChange={(ev) => setForm((f) => ({ ...f, defaultHours: ev.target.value }))}
              style={fieldStyle}
            />
            {errors.defaultHours && <FieldError msg={errors.defaultHours} />}
          </label>
          <label style={labelStyle} htmlFor={`${idPrefix}-capacity`}>
            Capacity
            <input
              id={`${idPrefix}-capacity`}
              aria-label={idPrefix === 'create' ? 'Capacity' : 'Edit capacity'}
              type="number"
              min={1}
              step={1}
              value={form.capacity}
              onChange={(ev) => setForm((f) => ({ ...f, capacity: ev.target.value }))}
              placeholder="Unlimited"
              style={fieldStyle}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, display: 'block', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
              Leave blank for unlimited
            </span>
          </label>
        </div>

        <label style={labelStyle} htmlFor={`${idPrefix}-location`}>
          Location
          <input
            id={`${idPrefix}-location`}
            aria-label={idPrefix === 'create' ? 'Location' : 'Edit location'}
            value={form.location}
            onChange={(ev) => setForm((f) => ({ ...f, location: ev.target.value }))}
            placeholder="Brampton"
            style={fieldStyle}
          />
        </label>

        <label style={labelStyle} htmlFor={`${idPrefix}-description`}>
          Description
          <textarea
            id={`${idPrefix}-description`}
            aria-label={idPrefix === 'create' ? 'Description' : 'Edit description'}
            value={form.description}
            onChange={(ev) => setForm((f) => ({ ...f, description: ev.target.value }))}
            placeholder="What will families be helping with?"
            rows={3}
            style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </label>
      </div>
    );
  }

  const formActionBtn: React.CSSProperties = { padding: '12px 24px', minHeight: 46 };

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: 28 }}>
        <p style={eyebrowStyle}>Seva</p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 8, lineHeight: 1.08 }}>
          Seva opportunities
        </h1>
        <p style={{ fontSize: 15, color: 'var(--body-text)', marginTop: 12, maxWidth: 560, lineHeight: 1.55 }}>
          Post seva opportunities for families to sign up for, and set the yearly seva-hours target.
        </p>
      </header>

      {/* Requirement panel */}
      <div className="card" style={{ padding: 'clamp(18px, 4vw, 24px)', marginBottom: 28 }}>
        {editingReq ? (
          <div>
            <div style={{ ...sectionLabelStyle, marginBottom: 16 }}>Seva requirement</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <label style={labelStyle} htmlFor="seva-year">
                Seva year
                <input
                  id="seva-year"
                  aria-label="Seva year"
                  value={reqYear}
                  onChange={(ev) => setReqYear(ev.target.value)}
                  placeholder="2025-26"
                  style={fieldStyle}
                />
              </label>
              <label style={labelStyle} htmlFor="seva-hours">
                Hours / family / year
                <input
                  id="seva-hours"
                  aria-label="Hours per family per year"
                  type="number"
                  min={1}
                  step={1}
                  value={reqHours}
                  onChange={(ev) => setReqHours(ev.target.value)}
                  style={fieldStyle}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--p"
                onClick={submitReq}
                disabled={savingReq}
                style={formActionBtn}
              >
                {savingReq ? 'Saving…' : 'Save requirement'}
              </button>
              <button type="button" className="btn btn--g" onClick={() => setEditingReq(false)} style={{ minHeight: 46 }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...sectionLabelStyle, marginBottom: 10 }}>Seva requirement</div>
              {hasYear ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 30, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em', lineHeight: 1 }}>
                    {requirement.currentSevaYear}
                  </span>
                  <span
                    className="pill"
                    style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', fontWeight: 600 }}
                  >
                    {requirement.hoursPerYear} hrs / family / year
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'var(--accentSoft)',
                    color: 'var(--accentDeep)',
                    borderRadius: 'var(--radiusSm)',
                    padding: '14px 16px',
                    fontSize: 14,
                    fontWeight: 600,
                    maxWidth: 440,
                    lineHeight: 1.45,
                  }}
                >
                  <SetuIcon.calendar style={{ flex: '0 0 auto' }} />
                  <span>Set a seva year to start posting opportunities.</span>
                </div>
              )}
              {!canEditRequirement && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Admin-managed</div>
              )}
            </div>
            {canEditRequirement && (
              <button type="button" className="btn btn--s" onClick={openReqEdit} style={{ flex: '0 0 auto', minHeight: 42 }}>
                <SetuIcon.edit /> Edit requirement
              </button>
            )}
          </div>
        )}
      </div>

      {/* Opportunities section header + New-opportunity action */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 14,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p style={eyebrowStyle}>Opportunities</p>
          <h2 style={{ fontSize: 20, fontWeight: 500, marginTop: 6, lineHeight: 1.1 }}>
            {opportunities.length} posted
          </h2>
        </div>
        {!creating && (
          <button
            type="button"
            className="btn btn--p"
            onClick={() => {
              setCreateForm(emptyForm());
              setCreateErrors({});
              setCreating(true);
            }}
            style={{ minHeight: 46 }}
          >
            <SetuIcon.plus /> New opportunity
          </button>
        )}
      </div>

      {creating && (
        <div className="card" style={{ padding: 'clamp(18px, 4vw, 24px)', marginBottom: 22 }}>
          <div style={{ ...sectionLabelStyle, marginBottom: 16 }}>New opportunity</div>
          {renderOppFields(createForm, setCreateForm, createErrors, 'create')}
          <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--p"
              onClick={submitCreate}
              disabled={savingCreate}
              style={formActionBtn}
            >
              {savingCreate ? 'Posting…' : 'Create opportunity'}
            </button>
            <button type="button" className="btn btn--g" onClick={() => setCreating(false)} style={{ minHeight: 46 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {opportunities.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 'clamp(28px, 7vw, 44px) 24px',
            textAlign: 'center',
            background: 'var(--surface)',
          }}
        >
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              background: 'var(--accentSoft)',
              color: 'var(--accentDeep)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <SetuIcon.heart />
          </div>
          <p style={{ fontSize: 17, color: 'var(--ink)', fontWeight: 600 }}>No opportunities yet</p>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8, maxWidth: 320, marginInline: 'auto', lineHeight: 1.5 }}>
            Post the first seva opportunity so families can sign up and start logging hours.
          </p>
          {!creating && (
            <button
              type="button"
              className="btn btn--p"
              onClick={() => {
                setCreateForm(emptyForm());
                setCreateErrors({});
                setCreating(true);
              }}
              style={{ marginTop: 20, minHeight: 46 }}
            >
              <SetuIcon.plus /> Post an opportunity
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {opportunities.map((o) => {
            const isEditing = editingId === o.oppId;
            const isOpen = o.status === 'open';
            return (
              <div
                key={o.oppId}
                className="card"
                style={{
                  padding: 'clamp(16px, 4vw, 22px)',
                  opacity: !isEditing && !isOpen ? 0.78 : 1,
                  transition: 'box-shadow .12s, opacity .12s',
                }}
              >
                {isEditing ? (
                  <div>
                    <div style={{ ...sectionLabelStyle, marginBottom: 16 }}>Edit opportunity</div>
                    {renderOppFields(editForm, setEditForm, editErrors, 'edit')}
                    <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn--p"
                        onClick={() => submitEdit(o.oppId)}
                        disabled={savingEdit}
                        style={formActionBtn}
                      >
                        {savingEdit ? 'Saving…' : 'Save changes'}
                      </button>
                      <button type="button" className="btn btn--g" onClick={() => setEditingId(null)} style={{ minHeight: 46 }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25, letterSpacing: '-0.01em' }}>
                          {o.title}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 8,
                            marginTop: 8,
                            fontSize: 13.5,
                            color: 'var(--body-text)',
                          }}
                        >
                          <span>{fmtDate(o.date)}</span>
                          {o.location && (<><Dot /><span>{o.location}</span></>)}
                          <Dot />
                          <span>{o.defaultHours} hrs</span>
                          <Dot />
                          <span>{capacityLabel(o.capacity)}</span>
                        </div>
                        {o.description && (
                          <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.55 }}>
                            {o.description}
                          </p>
                        )}
                      </div>
                      <span
                        className="pill"
                        style={{
                          flex: '0 0 auto',
                          textTransform: 'capitalize',
                          fontWeight: 600,
                          background: isOpen ? 'var(--accentSoft)' : 'var(--surface2)',
                          color: isOpen ? 'var(--accentDeep)' : 'var(--muted)',
                        }}
                      >
                        {o.status}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        marginTop: 18,
                        paddingTop: 16,
                        borderTop: '1px solid var(--line)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <Link
                        href={`/welcome/seva/${o.oppId}`}
                        className="btn btn--s"
                        style={{ flex: '1 1 auto', minWidth: 120, minHeight: 44, textDecoration: 'none' }}
                      >
                        <SetuIcon.people /> View roster
                      </Link>
                      <button
                        type="button"
                        className="btn btn--s"
                        onClick={() => openEdit(o)}
                        style={{ flex: '1 1 auto', minWidth: 120, minHeight: 44 }}
                      >
                        <SetuIcon.edit /> Edit
                      </button>
                      {isOpen && (
                        <button
                          type="button"
                          className="btn btn--g"
                          onClick={() => closeOpp(o.oppId)}
                          disabled={closingId === o.oppId}
                          style={{ flex: '1 1 auto', minWidth: 120, minHeight: 44 }}
                        >
                          {closingId === o.oppId ? 'Closing…' : 'Close'}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
