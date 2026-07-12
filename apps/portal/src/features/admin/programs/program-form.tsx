'use client';

import { useState, useTransition } from 'react';
import { toast } from '@cmt/ui';
import type { ProgramDoc, Location, ProgramTermType, MemberType, AttendanceMode } from '@cmt/shared-domain';
import { PROGRAM_TERM_TYPES, MEMBER_TYPES, ATTENDANCE_MODES } from '@cmt/shared-domain';
import type { ProgramRow } from './programs-table';

export type { ProgramRow };

interface ProgramFormProps {
  program: ProgramRow;
  /** Admin-managed centre list (from getLocationOptions()) for the picker. */
  locationOptions: string[];
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

export function ProgramForm({ program, locationOptions }: ProgramFormProps) {
  const [pending, startTransition] = useTransition();

  const [label, setLabel] = useState(program.label);
  const [shortDescription, setShortDescription] = useState(program.shortDescription);
  const [status, setStatus] = useState<ProgramDoc['status']>(program.status);
  const [selectedLocations, setSelectedLocations] = useState<Location[]>(program.locations as Location[]);
  const [termType, setTermType] = useState<ProgramTermType>(program.termType);
  const [memberType, setMemberType] = useState<MemberType>(program.eligibility.memberType);
  const [minAge, setMinAge] = useState(program.eligibility.minAgeYears != null ? String(program.eligibility.minAgeYears) : '');
  const [maxAge, setMaxAge] = useState(program.eligibility.maxAgeYears != null ? String(program.eligibility.maxAgeYears) : '');
  const [usesOfferings, setUsesOfferings] = useState(program.capabilities.usesOfferings);
  const [usesDonation, setUsesDonation] = useState(program.capabilities.usesDonation);
  const [usesLevels, setUsesLevels] = useState(program.capabilities.usesLevels);
  const [usesCalendar, setUsesCalendar] = useState(program.capabilities.usesCalendar);
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>(program.capabilities.attendanceMode);
  const [displayOrder, setDisplayOrder] = useState(String(program.displayOrder));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function toggleLocation(loc: Location) {
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc],
    );
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!label.trim()) e.label = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;

    startTransition(async () => {
      try {
        // Only send changed fields (PATCH semantics)
        const body: Record<string, unknown> = {};
        if (label !== program.label) body.label = label;
        if (shortDescription !== program.shortDescription) body.shortDescription = shortDescription;
        if (status !== program.status) body.status = status;
        if (JSON.stringify(selectedLocations) !== JSON.stringify(program.locations)) body.locations = selectedLocations;
        if (termType !== program.termType) body.termType = termType;

        const newEligibility: ProgramDoc['eligibility'] = { memberType };
        if (minAge !== '') (newEligibility as Record<string, unknown>).minAgeYears = Number(minAge);
        if (maxAge !== '') (newEligibility as Record<string, unknown>).maxAgeYears = Number(maxAge);
        if (JSON.stringify(newEligibility) !== JSON.stringify(program.eligibility)) body.eligibility = newEligibility;

        const newCaps = { usesOfferings, usesDonation, usesLevels, usesCalendar, attendanceMode };
        if (JSON.stringify(newCaps) !== JSON.stringify(program.capabilities)) body.capabilities = newCaps;

        if (Number(displayOrder) !== program.displayOrder) body.displayOrder = Number(displayOrder) || 0;

        if (Object.keys(body).length === 0) {
          toast.success('No changes to save.');
          return;
        }

        const res = await fetch(`/api/admin/programs/${program.programKey}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error((json as { error?: string }).error ?? 'Save failed');
          return;
        }
        toast.success('Program updated.');
      } catch {
        toast.error('Network error — please try again.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        <label style={labelStyle} htmlFor="pf-label">
          Label
          <input id="pf-label" value={label} onChange={(e) => setLabel(e.target.value)} style={fieldStyle} aria-label="Label" />
          {errors.label && <FieldError msg={errors.label} />}
        </label>

        <label style={labelStyle} htmlFor="pf-desc">
          Short description
          <input id="pf-desc" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} placeholder="One-line description" style={fieldStyle} aria-label="Short description" />
        </label>

        <label style={labelStyle} htmlFor="pf-status">
          Status
          <select id="pf-status" value={status} onChange={(e) => setStatus(e.target.value as ProgramDoc['status'])} style={fieldStyle}>
            <option value="draft">Draft (hidden from families)</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>

        <label style={labelStyle} htmlFor="pf-term-type">
          Term type
          <select id="pf-term-type" value={termType} onChange={(e) => setTermType(e.target.value as ProgramTermType)} style={fieldStyle}>
            {PROGRAM_TERM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <div>
          <div style={labelStyle}>Locations (empty = location-less / online)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {locationOptions.map((loc) => (
              <label key={loc} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedLocations.includes(loc)}
                  onChange={() => toggleLocation(loc)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                {loc}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div style={labelStyle}>Eligibility</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
            <label style={labelStyle} htmlFor="pf-member-type">
              Member type
              <select id="pf-member-type" value={memberType} onChange={(e) => setMemberType(e.target.value as MemberType)} style={fieldStyle}>
                {MEMBER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={labelStyle}>
                Min age (years, optional)
                <input type="number" min={0} value={minAge} onChange={(e) => setMinAge(e.target.value)} placeholder="—" style={fieldStyle} />
              </label>
              <label style={labelStyle}>
                Max age (years, optional)
                <input type="number" min={0} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} placeholder="—" style={fieldStyle} />
              </label>
            </div>
          </div>
        </div>

        <div>
          <div style={labelStyle}>Capabilities</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            {[
              { key: 'usesOfferings', capLabel: 'Uses offerings (enrollable terms)', value: usesOfferings, set: setUsesOfferings },
              { key: 'usesDonation', capLabel: 'Uses donation', value: usesDonation, set: setUsesDonation },
              { key: 'usesLevels', capLabel: 'Uses levels (class placement)', value: usesLevels, set: setUsesLevels },
              { key: 'usesCalendar', capLabel: 'Uses calendar (published schedule)', value: usesCalendar, set: setUsesCalendar },
            ].map(({ key, capLabel, value, set }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--accent)' }} />
                {capLabel}
              </label>
            ))}
            <label style={labelStyle} htmlFor="pf-attendance-mode">
              Attendance mode
              <select id="pf-attendance-mode" value={attendanceMode} onChange={(e) => setAttendanceMode(e.target.value as AttendanceMode)} style={fieldStyle}>
                {ATTENDANCE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
        </div>

        <label style={labelStyle} htmlFor="pf-display-order">
          Display order
          <input id="pf-display-order" type="number" min={0} step={1} value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} style={fieldStyle} />
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 6 }}>
          <button type="submit" disabled={pending} className="btn btn--p" style={{ padding: '10px 24px', fontSize: 14, opacity: pending ? 0.6 : 1 }}>
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </div>

      </div>
    </form>
  );
}
