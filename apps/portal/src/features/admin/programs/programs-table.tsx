'use client';

import { useState, useTransition } from 'react';
import { toast } from '@cmt/ui';
import type {
  ProgramDoc,
  Location,
  ProgramTermType,
  MemberType,
  AttendanceMode,
} from '@cmt/shared-domain';
import { LOCATIONS, PROGRAM_TERM_TYPES, MEMBER_TYPES, ATTENDANCE_MODES } from '@cmt/shared-domain';
import Link from 'next/link';

// Serialised shape from GET /api/admin/programs (Timestamps → ISO strings)
export type ProgramRow = Omit<ProgramDoc, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

interface ProgramsTableProps {
  initialPrograms: ProgramRow[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function statusColor(status: ProgramDoc['status']): { bg: string; color: string } {
  if (status === 'active') return { bg: 'var(--accentSoft)', color: 'var(--accentDeep)' };
  if (status === 'draft') return { bg: 'var(--surface2)', color: 'var(--muted)' };
  return { bg: 'var(--surface2)', color: 'var(--muted)' };
}

function CapBadge({ label, on }: { label: string; on: boolean }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 99, fontSize: 10,
      fontWeight: 700, background: on ? 'var(--accentSoft)' : 'var(--surface2)',
      color: on ? 'var(--accentDeep)' : 'var(--muted)', border: '1px solid var(--line)',
      marginRight: 3,
    }}>
      {label}
    </span>
  );
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreated: (program: ProgramRow) => void;
}

function CreateProgramModal({ onClose, onCreated }: CreateModalProps) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState('');
  const [programKey, setProgramKey] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [status, setStatus] = useState<ProgramDoc['status']>('draft');
  const [selectedLocations, setSelectedLocations] = useState<Location[]>([]);
  const [termType, setTermType] = useState<ProgramTermType>('term');
  const [memberType, setMemberType] = useState<MemberType>('child');
  const [minAge, setMinAge] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [usesOfferings, setUsesOfferings] = useState(true);
  const [usesDonation, setUsesDonation] = useState(false);
  const [usesLevels, setUsesLevels] = useState(false);
  const [usesCalendar, setUsesCalendar] = useState(false);
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>('none');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function toggleLocation(loc: Location) {
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc],
    );
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!label.trim()) e.label = 'Required';
    if (!programKey.trim()) e.programKey = 'Required';
    if (!/^[a-z0-9-]+$/.test(programKey)) e.programKey = 'Must be a lowercase slug (letters, numbers, hyphens)';
    if (displayOrder !== '' && !Number.isInteger(Number(displayOrder))) e.displayOrder = 'Must be a whole number';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;

    const eligibility: ProgramDoc['eligibility'] = { memberType };
    if (minAge !== '') (eligibility as Record<string, unknown>).minAgeYears = Number(minAge);
    if (maxAge !== '') (eligibility as Record<string, unknown>).maxAgeYears = Number(maxAge);

    startTransition(async () => {
      try {
        const body = {
          programKey,
          label,
          shortDescription,
          status,
          locations: selectedLocations,
          termType,
          eligibility,
          capabilities: { usesOfferings, usesDonation, usesLevels, usesCalendar, attendanceMode },
          displayOrder: Number(displayOrder) || 0,
        };
        const res = await fetch('/api/admin/programs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error((json as { error?: string }).error ?? 'Save failed');
          return;
        }
        toast.success('Program created.');
        const now = new Date().toISOString();
        onCreated({
          programKey,
          label,
          shortDescription,
          status,
          locations: selectedLocations,
          termType,
          eligibility,
          capabilities: { usesOfferings, usesDonation, usesLevels, usesCalendar, attendanceMode },
          displayOrder: Number(displayOrder) || 0,
          createdAt: now,
          createdBy: '',
          updatedAt: now,
          updatedBy: '',
        });
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
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>New program</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 20, cursor: 'pointer', color: 'var(--muted)', padding: 4 }} aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <label style={labelStyle} htmlFor="prog-label">
              Label
              <input id="prog-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bala Vihar" style={fieldStyle} aria-label="Label" />
              {errors.label && <FieldError msg={errors.label} />}
            </label>

            <label style={labelStyle} htmlFor="prog-key">
              Program key
              <input id="prog-key" value={programKey} onChange={(e) => setProgramKey(e.target.value)} placeholder="bala-vihar" style={fieldStyle} aria-label="Program key" />
              {errors.programKey && <FieldError msg={errors.programKey} />}
            </label>

            <label style={labelStyle} htmlFor="prog-desc">
              Short description
              <input id="prog-desc" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} placeholder="One-line description" style={fieldStyle} aria-label="Short description" />
            </label>

            <label style={labelStyle} htmlFor="prog-status">
              Status
              <select id="prog-status" value={status} onChange={(e) => setStatus(e.target.value as ProgramDoc['status'])} style={fieldStyle}>
                <option value="draft">Draft (hidden from families)</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>

            <label style={labelStyle} htmlFor="prog-term-type">
              Term type
              <select id="prog-term-type" value={termType} onChange={(e) => setTermType(e.target.value as ProgramTermType)} style={fieldStyle}>
                {PROGRAM_TERM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <div>
              <div style={labelStyle}>Locations (empty = location-less / online)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {LOCATIONS.map((loc) => (
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
                <label style={labelStyle} htmlFor="prog-member-type">
                  Member type
                  <select id="prog-member-type" value={memberType} onChange={(e) => setMemberType(e.target.value as MemberType)} style={fieldStyle}>
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
                  { key: 'usesOfferings', label: 'Uses offerings (enrollable terms)', value: usesOfferings, set: setUsesOfferings },
                  { key: 'usesDonation', label: 'Uses donation (dakshina)', value: usesDonation, set: setUsesDonation },
                  { key: 'usesLevels', label: 'Uses levels (class placement)', value: usesLevels, set: setUsesLevels },
                  { key: 'usesCalendar', label: 'Uses calendar (published schedule)', value: usesCalendar, set: setUsesCalendar },
                ].map(({ key, label: capLabel, value, set }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--accent)' }} />
                    {capLabel}
                  </label>
                ))}
                <label style={labelStyle} htmlFor="prog-attendance-mode">
                  Attendance mode
                  <select id="prog-attendance-mode" value={attendanceMode} onChange={(e) => setAttendanceMode(e.target.value as AttendanceMode)} style={fieldStyle}>
                    {ATTENDANCE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <label style={labelStyle} htmlFor="prog-display-order">
              Display order
              <input id="prog-display-order" type="number" min={0} step={1} value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} style={fieldStyle} />
              {errors.displayOrder && <FieldError msg={errors.displayOrder} />}
            </label>

          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={pending} className="btn btn--p" style={{ padding: '9px 22px', fontSize: 13, opacity: pending ? 0.6 : 1 }}>
              {pending ? 'Saving…' : 'Create program'}
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
const cancelBtnStyle: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 'var(--radiusSm)', fontSize: 13, fontWeight: 500,
  background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer',
  color: 'var(--body-text)', fontFamily: 'var(--body)',
};
const tdStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const actionBtnStyle: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 'var(--radiusSm)', fontSize: 12, fontWeight: 500,
  background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer',
  color: 'var(--body-text)', fontFamily: 'var(--body)', textDecoration: 'none', display: 'inline-block',
};
const cardKeyStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
  letterSpacing: '.06em', whiteSpace: 'nowrap', paddingTop: 1,
};

// ─── Main table ──────────────────────────────────────────────────────────────

export function ProgramsTable({ initialPrograms }: ProgramsTableProps) {
  const [programs, setPrograms] = useState<ProgramRow[]>(initialPrograms);
  const [modalOpen, setModalOpen] = useState(false);

  function handleCreated(p: ProgramRow) {
    setPrograms((prev) => [...prev, p].sort((a, b) => a.displayOrder - b.displayOrder));
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }} />
        <button className="btn btn--p" onClick={() => setModalOpen(true)} style={{ fontSize: 13, padding: '8px 18px' }}>
          + New program
        </button>
      </div>

      {programs.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          No programs yet. Create one to get started.
        </div>
      ) : (
        <>
          {/* Mobile: stacked card rows */}
          <div className="block md:hidden">
            {programs.map((p, i) => {
              const sc = statusColor(p.status);
              return (
                <div key={p.programKey} style={{ padding: '16px 0', borderTop: i > 0 ? '1px solid var(--line)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{p.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{p.programKey}</div>
                    </div>
                    <span style={{ flex: '0 0 auto', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>
                      {p.status}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13, marginBottom: 10 }}>
                    <span style={cardKeyStyle}>Term</span>
                    <span style={{ color: 'var(--body-text)' }}>{p.termType}</span>
                    <span style={cardKeyStyle}>Eligibility</span>
                    <span style={{ color: 'var(--body-text)' }}>{p.eligibility.memberType}</span>
                    <span style={cardKeyStyle}>Order</span>
                    <span style={{ color: 'var(--body-text)' }}>{p.displayOrder}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 10 }}>
                    <CapBadge label="offerings" on={p.capabilities.usesOfferings} />
                    <CapBadge label="donation" on={p.capabilities.usesDonation} />
                    <CapBadge label="levels" on={p.capabilities.usesLevels} />
                    <CapBadge label="calendar" on={p.capabilities.usesCalendar} />
                  </div>
                  <Link href={`/admin/programs/${p.programKey}`} style={{ ...actionBtnStyle, display: 'block', textAlign: 'center', padding: '9px 12px' }}>
                    Edit
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Desktop: full table */}
          <div className="hidden md:block" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)' }}>
                  {['Label', 'Key', 'Status', 'Term', 'Eligibility', 'Capabilities', 'Order', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {programs.map((p, i) => {
                  const sc = statusColor(p.status);
                  return (
                    <tr key={p.programKey} style={{ borderBottom: '1px solid var(--line)', background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{p.label}</td>
                      <td style={{ ...tdStyle, color: 'var(--muted)', fontFamily: 'monospace' }}>{p.programKey}</td>
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>
                          {p.status}
                        </span>
                      </td>
                      <td style={tdStyle}>{p.termType}</td>
                      <td style={tdStyle}>{p.eligibility.memberType}</td>
                      <td style={tdStyle}>
                        <CapBadge label="offerings" on={p.capabilities.usesOfferings} />
                        <CapBadge label="donation" on={p.capabilities.usesDonation} />
                        <CapBadge label="levels" on={p.capabilities.usesLevels} />
                        <CapBadge label="calendar" on={p.capabilities.usesCalendar} />
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--muted)' }}>{p.displayOrder}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <Link href={`/admin/programs/${p.programKey}`} style={actionBtnStyle}>Edit</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modalOpen && <CreateProgramModal onClose={() => setModalOpen(false)} onCreated={handleCreated} />}
    </>
  );
}
