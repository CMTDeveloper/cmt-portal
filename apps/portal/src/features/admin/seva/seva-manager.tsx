'use client';

import { useState, useTransition } from 'react';
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
  letterSpacing: '.08em',
};
const fieldStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '9px 11px',
  borderRadius: 'var(--radiusSm)',
  border: '1px solid var(--line2)',
  background: 'var(--bg)',
  fontSize: 14,
  color: 'var(--ink)',
  fontFamily: 'var(--body)',
  boxSizing: 'border-box',
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
  return capacity == null ? 'unlimited' : `${capacity} spot${capacity === 1 ? '' : 's'}`;
}

function FieldError({ msg }: { msg: string }) {
  return <span style={{ fontSize: 11, color: 'var(--err)', marginTop: 4, display: 'block' }}>{msg}</span>;
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
    if (!confirm('Close this opportunity? Families will no longer be able to sign up for it.')) return;
    const res = await updateOpportunity(oppId, { status: 'closed' });
    if (!res.ok) {
      toast.error(res.error ?? 'Close failed');
      return;
    }
    setOpportunities((prev) => prev.map((o) => (o.oppId === oppId ? { ...o, status: 'closed' } : o)));
    toast.success('Opportunity closed');
  }

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Seva
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>
          Seva opportunities
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 640, lineHeight: 1.55 }}>
          Post seva opportunities for families to sign up for, and set the yearly seva-hours target.
        </p>
      </header>

      {/* Requirement panel */}
      <div className="card" style={{ padding: 'clamp(16px, 4vw, 22px)', marginBottom: 20 }}>
        {editingReq ? (
          <div>
            <div style={{ ...labelStyle, marginBottom: 12 }}>Seva requirement</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
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
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--p"
                onClick={submitReq}
                disabled={savingReq}
                style={{ padding: '10px 22px' }}
              >
                {savingReq ? 'Saving…' : 'Save requirement'}
              </button>
              <button type="button" className="btn btn--g" onClick={() => setEditingReq(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="between" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ ...labelStyle, marginBottom: 8 }}>Seva requirement</div>
              {hasYear ? (
                <>
                  <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)' }}>
                    {requirement.currentSevaYear}
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 4 }}>
                    {requirement.hoursPerYear} hrs / family / year
                  </div>
                </>
              ) : (
                <div
                  style={{
                    background: 'var(--accentSoft)',
                    color: 'var(--accentDeep)',
                    borderRadius: 'var(--radiusSm)',
                    padding: '12px 14px',
                    fontSize: 14,
                    fontWeight: 600,
                    maxWidth: 420,
                  }}
                >
                  Set a seva year to start posting opportunities.
                </div>
              )}
              {!canEditRequirement && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Admin-managed</div>
              )}
            </div>
            {canEditRequirement && (
              <button type="button" className="btn btn--s" onClick={openReqEdit} style={{ flex: '0 0 auto' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <SetuIcon.edit /> Edit requirement
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* New opportunity button + inline create panel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {opportunities.length} {opportunities.length === 1 ? 'opportunity' : 'opportunities'}
        </div>
        <div style={{ flex: 1 }} />
        {!creating && (
          <button
            type="button"
            className="btn btn--p"
            onClick={() => {
              setCreateForm(emptyForm());
              setCreateErrors({});
              setCreating(true);
            }}
            style={{ padding: '10px 20px' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <SetuIcon.plus /> New opportunity
            </span>
          </button>
        )}
      </div>

      {creating && (
        <div className="card" style={{ padding: 'clamp(16px, 4vw, 22px)', marginBottom: 20 }}>
          <div style={{ ...labelStyle, marginBottom: 12 }}>New opportunity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={labelStyle} htmlFor="create-title">
              Title
              <input
                id="create-title"
                aria-label="Title"
                value={createForm.title}
                onChange={(ev) => setCreateForm((f) => ({ ...f, title: ev.target.value }))}
                placeholder="Diwali hall setup"
                style={fieldStyle}
              />
              {createErrors.title && <FieldError msg={createErrors.title} />}
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <label style={labelStyle} htmlFor="create-date">
                Date
                <input
                  id="create-date"
                  aria-label="Date"
                  type="date"
                  value={createForm.date}
                  onChange={(ev) => setCreateForm((f) => ({ ...f, date: ev.target.value }))}
                  style={fieldStyle}
                />
                {createErrors.date && <FieldError msg={createErrors.date} />}
              </label>
              <label style={labelStyle} htmlFor="create-hours">
                Default hours
                <input
                  id="create-hours"
                  aria-label="Default hours"
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={createForm.defaultHours}
                  onChange={(ev) => setCreateForm((f) => ({ ...f, defaultHours: ev.target.value }))}
                  style={fieldStyle}
                />
                {createErrors.defaultHours && <FieldError msg={createErrors.defaultHours} />}
              </label>
              <label style={labelStyle} htmlFor="create-capacity">
                Capacity (blank = unlimited)
                <input
                  id="create-capacity"
                  aria-label="Capacity"
                  type="number"
                  min={1}
                  step={1}
                  value={createForm.capacity}
                  onChange={(ev) => setCreateForm((f) => ({ ...f, capacity: ev.target.value }))}
                  placeholder="∞"
                  style={fieldStyle}
                />
              </label>
            </div>

            <label style={labelStyle} htmlFor="create-location">
              Location
              <input
                id="create-location"
                aria-label="Location"
                value={createForm.location}
                onChange={(ev) => setCreateForm((f) => ({ ...f, location: ev.target.value }))}
                placeholder="Brampton"
                style={fieldStyle}
              />
            </label>

            <label style={labelStyle} htmlFor="create-description">
              Description
              <textarea
                id="create-description"
                aria-label="Description"
                className="input"
                value={createForm.description}
                onChange={(ev) => setCreateForm((f) => ({ ...f, description: ev.target.value }))}
                placeholder="What will families be helping with?"
                rows={3}
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--p"
              onClick={submitCreate}
              disabled={savingCreate}
              style={{ padding: '10px 22px' }}
            >
              {savingCreate ? 'Posting…' : 'Create opportunity'}
            </button>
            <button type="button" className="btn btn--g" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {opportunities.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 500 }}>No opportunities yet</p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Post the first one.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {opportunities.map((o) => {
            const isEditing = editingId === o.oppId;
            const statusBg = o.status === 'open' ? 'var(--accentSoft)' : 'var(--surface2)';
            const statusColor = o.status === 'open' ? 'var(--accentDeep)' : 'var(--muted)';
            return (
              <div key={o.oppId} className="card" style={{ padding: 'clamp(14px, 4vw, 20px)' }}>
                {isEditing ? (
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 12 }}>Edit opportunity</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <label style={labelStyle}>
                        Title
                        <input
                          aria-label="Edit title"
                          value={editForm.title}
                          onChange={(ev) => setEditForm((f) => ({ ...f, title: ev.target.value }))}
                          style={fieldStyle}
                        />
                        {editErrors.title && <FieldError msg={editErrors.title} />}
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                        <label style={labelStyle}>
                          Date
                          <input
                            aria-label="Edit date"
                            type="date"
                            value={editForm.date}
                            onChange={(ev) => setEditForm((f) => ({ ...f, date: ev.target.value }))}
                            style={fieldStyle}
                          />
                          {editErrors.date && <FieldError msg={editErrors.date} />}
                        </label>
                        <label style={labelStyle}>
                          Default hours
                          <input
                            aria-label="Edit default hours"
                            type="number"
                            min={0.5}
                            step={0.5}
                            value={editForm.defaultHours}
                            onChange={(ev) => setEditForm((f) => ({ ...f, defaultHours: ev.target.value }))}
                            style={fieldStyle}
                          />
                          {editErrors.defaultHours && <FieldError msg={editErrors.defaultHours} />}
                        </label>
                        <label style={labelStyle}>
                          Capacity (blank = unlimited)
                          <input
                            aria-label="Edit capacity"
                            type="number"
                            min={1}
                            step={1}
                            value={editForm.capacity}
                            onChange={(ev) => setEditForm((f) => ({ ...f, capacity: ev.target.value }))}
                            placeholder="∞"
                            style={fieldStyle}
                          />
                        </label>
                      </div>
                      <label style={labelStyle}>
                        Location
                        <input
                          aria-label="Edit location"
                          value={editForm.location}
                          onChange={(ev) => setEditForm((f) => ({ ...f, location: ev.target.value }))}
                          style={fieldStyle}
                        />
                      </label>
                      <label style={labelStyle}>
                        Description
                        <textarea
                          aria-label="Edit description"
                          className="input"
                          value={editForm.description}
                          onChange={(ev) => setEditForm((f) => ({ ...f, description: ev.target.value }))}
                          rows={3}
                          style={{ ...fieldStyle, resize: 'vertical' }}
                        />
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn--p"
                        onClick={() => submitEdit(o.oppId)}
                        disabled={savingEdit}
                        style={{ padding: '10px 22px' }}
                      >
                        {savingEdit ? 'Saving…' : 'Save changes'}
                      </button>
                      <button type="button" className="btn btn--g" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>{o.title}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6, fontSize: 13, color: 'var(--body-text)' }}>
                          <span>{fmtDate(o.date)}</span>
                          {o.location && <span>{o.location}</span>}
                          <span>
                            {o.defaultHours} hrs · {capacityLabel(o.capacity)}
                          </span>
                        </div>
                        {o.description && (
                          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
                            {o.description}
                          </p>
                        )}
                      </div>
                      <span
                        className="pill"
                        style={{
                          flex: '0 0 auto',
                          padding: '3px 12px',
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 600,
                          background: statusBg,
                          color: statusColor,
                        }}
                      >
                        {o.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn--s" onClick={() => openEdit(o)}>
                        Edit
                      </button>
                      {o.status === 'open' && (
                        <button type="button" className="btn btn--g" onClick={() => closeOpp(o.oppId)}>
                          Close
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
