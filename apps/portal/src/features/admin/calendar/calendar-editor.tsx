'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SetuIcon,
  toast,
} from '@cmt/ui';
import type {
  CalendarKind,
  ClassType,
  CreateCalendarEntryInput,
  Location,
} from '@cmt/shared-domain';
import type { ProgramRow } from '@/features/admin/programs/programs-table';

interface EntryRow {
  entryId: string;
  programKey: string;
  location: Location;
  date: string;
  kind: CalendarKind;
  classType: ClassType | null;
  noClassReason: string | null;
  specialEvents: string | null;
  enabled: boolean;
  prasadNeeded: boolean;
}

interface ScheduleRow {
  time: string;
  label: string;
}

interface CalendarEditorProps {
  locations: Location[];
  /** Optional: list of programs. When provided, shows a program selector filtered to usesCalendar programs. */
  programs?: ProgramRow[];
  /** Optional school-year window (YYYY-MM-DD). When set, entries are filtered to this range. */
  windowStart?: string;
  windowEnd?: string;
}

export function CalendarEditor({ locations, programs, windowStart, windowEnd }: CalendarEditorProps) {
  const [location, setLocation] = useState<Location>(locations[0] ?? 'Brampton');

  // Programs that use calendar — for the program selector
  const calendarPrograms = programs?.filter((p) => p.capabilities.usesCalendar) ?? [];
  const [programKey, setProgramKey] = useState('bala-vihar');
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [weekly, setWeekly] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  // New-entry form state
  const [addOpen, setAddOpen] = useState(false);
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<CalendarKind>('class');
  const [classType, setClassType] = useState<ClassType>('regular');
  const [noClassReason, setNoClassReason] = useState('');
  const [specialEvents, setSpecialEvents] = useState('');
  const [prasadNeeded, setPrasadNeeded] = useState(true);

  async function load(loc: Location) {
    setLoading(true);
    try {
      const [cRes, wRes] = await Promise.all([
        fetch(`/api/admin/calendar?location=${encodeURIComponent(loc)}`),
        fetch(`/api/admin/calendar/weekly?location=${encodeURIComponent(loc)}`),
      ]);
      if (cRes.ok) {
        const raw = (((await cRes.json()).entries as Array<EntryRow & { prasadNeeded?: boolean }>) ?? []);
        // Legacy entries predate the flag; treat a missing value as true.
        setEntries(raw.map((e) => ({ ...e, prasadNeeded: e.prasadNeeded !== false })));
      }
      if (wRes.ok) setWeekly(((await wRes.json()).rows as ScheduleRow[]) ?? []);
    } catch {
      toast.error('Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(location);
  }, [location]);

  function resetAddForm() {
    setDate('');
    setKind('class');
    setClassType('regular');
    setNoClassReason('');
    setSpecialEvents('');
    setPrasadNeeded(true);
  }

  function openAddDialog() {
    resetAddForm();
    setAddOpen(true);
  }

  function addEntry(ev: React.FormEvent) {
    ev.preventDefault();
    if (!date) {
      toast.error('Pick a date');
      return;
    }
    const body: CreateCalendarEntryInput = {
      programKey,
      location,
      date,
      kind,
      classType: kind === 'class' ? classType : null,
      noClassReason: kind === 'no-class' ? noClassReason.trim() || null : null,
      specialEvents: specialEvents.trim() || null,
      enabled: true,
      prasadNeeded: kind === 'class' ? prasadNeeded : false,
    };
    startTransition(async () => {
      const res = await fetch('/api/admin/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error === 'entry-conflict' ? 'An entry for that date already exists' : j.error ?? 'Add failed');
        return;
      }
      toast.success('Entry added.');
      await load(location);
      resetAddForm();
      setAddOpen(false);
    });
  }

  async function toggleEnabled(row: EntryRow) {
    const res = await fetch(`/api/admin/calendar/${row.entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !row.enabled }),
    });
    if (!res.ok) { toast.error('Toggle failed'); return; }
    setEntries((prev) => prev.map((e) => (e.entryId === row.entryId ? { ...e, enabled: !e.enabled } : e)));
  }

  async function togglePrasadNeeded(row: EntryRow) {
    const res = await fetch(`/api/admin/calendar/${row.entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prasadNeeded: !row.prasadNeeded }),
    });
    if (!res.ok) { toast.error('Toggle failed'); return; }
    setEntries((prev) => prev.map((e) => (e.entryId === row.entryId ? { ...e, prasadNeeded: !e.prasadNeeded } : e)));
  }

  async function remove(row: EntryRow) {
    const res = await fetch(`/api/admin/calendar/${row.entryId}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    setEntries((prev) => prev.filter((e) => e.entryId !== row.entryId));
    toast.success('Entry deleted.');
  }

  function saveWeekly() {
    startTransition(async () => {
      const res = await fetch('/api/admin/calendar/weekly', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location, rows: weekly.filter((r) => r.time.trim() && r.label.trim()) }),
      });
      if (!res.ok) { toast.error('Save failed'); return; }
      toast.success('Weekly schedule saved.');
    });
  }

  // The GET is location-wide (all programs), so scope the displayed list to the
  // selected program — otherwise, now that two programs can share a date+location
  // (program-scoped ids), the list would show indistinguishable rows. Creation,
  // toggle, and delete already act per-row via the stored (program-scoped) entryId.
  const visibleEntries = entries.filter(
    (e) =>
      e.programKey === programKey &&
      (windowStart === undefined || e.date >= windowStart) &&
      (windowEnd === undefined || e.date <= windowEnd),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={toolbarStyle}>
        <div style={toolbarFieldsStyle}>
          {calendarPrograms.length > 0 && (
            <label style={{ ...labelStyle, minWidth: 240, maxWidth: 300 }}>
              Program
              <select
                value={programKey}
                onChange={(e) => setProgramKey(e.target.value)}
                style={fieldStyle}
                aria-label="Program"
              >
                {calendarPrograms.map((p) => (
                  <option key={p.programKey} value={p.programKey}>{p.label}</option>
                ))}
              </select>
            </label>
          )}
          <label style={{ ...labelStyle, minWidth: 240, maxWidth: 300 }}>
            Location
            <select value={location} onChange={(e) => setLocation(e.target.value as Location)} style={fieldStyle}>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        <button type="button" onClick={openAddDialog} className="btn btn--p" style={addEntryButtonStyle}>
          <SetuIcon.plus aria-hidden="true" />
          Add a calendar entry
        </button>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent
          aria-describedby={undefined}
          // `csp` is required: DialogContent portals into document.body, OUTSIDE
          // the admin CspRoot, so the Setu brand tokens (var(--ink)/--surface/
          // --accent…) used by the inner form only resolve with `.csp` here.
          className="csp sm:max-w-3xl"
          style={{ maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}
        >
          <DialogHeader>
            <DialogTitle>Add a calendar entry</DialogTitle>
          </DialogHeader>
          <form onSubmit={addEntry} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label style={labelStyle}>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} /></label>
            <label style={labelStyle}>Kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as CalendarKind)}
                style={fieldStyle}
              >
                <option value="class">Class</option>
                <option value="no-class">No class</option>
              </select>
            </label>
            {kind === 'class' ? (
              <label style={labelStyle}>Class type
                <select value={classType} onChange={(e) => setClassType(e.target.value as ClassType)} style={fieldStyle}>
                  <option value="regular">Regular</option>
                  <option value="first">First class</option>
                  <option value="short">Short class</option>
                </select>
              </label>
            ) : (
              <label style={labelStyle}>No-class reason<input value={noClassReason} placeholder="Winter Break" onChange={(e) => setNoClassReason(e.target.value)} style={fieldStyle} /></label>
            )}
            <label style={labelStyle}>Special events (optional)<input value={specialEvents} placeholder="Ganesh Puja" onChange={(e) => setSpecialEvents(e.target.value)} style={fieldStyle} /></label>
            {kind === 'class' && (
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={prasadNeeded}
                  onChange={(e) => setPrasadNeeded(e.target.checked)}
                  style={checkboxStyle}
                />
                <span>Prasad needed</span>
              </label>
            )}
            <div style={dialogActionsStyle}>
              <button type="button" onClick={() => setAddOpen(false)} disabled={pending} className="btn" style={secondaryButtonStyle}>Cancel</button>
              <button type="submit" disabled={pending} className="btn btn--p" style={{ fontSize: 13, padding: '8px 18px', minHeight: 40 }}>Add entry</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Weekly schedule */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Weekly schedule</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {weekly.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
              <input value={r.time} placeholder="10:00 – 10:45 am" onChange={(e) => setWeekly((p) => p.map((x, idx) => idx === i ? { ...x, time: e.target.value } : x))} style={fieldStyle} />
              <input value={r.label} placeholder="Assembly" onChange={(e) => setWeekly((p) => p.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} style={fieldStyle} />
              <button type="button" onClick={() => setWeekly((p) => p.filter((_, idx) => idx !== i))} style={removeBtn} aria-label="Remove row">×</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button type="button" onClick={() => setWeekly((p) => [...p, { time: '', label: '' }])} style={linkBtn}>+ Add row</button>
          <button type="button" onClick={saveWeekly} disabled={pending} className="btn btn--p" style={{ fontSize: 13, padding: '6px 14px' }}>Save schedule</button>
        </div>
      </div>

      {/* Entry list */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{location} calendar {loading ? '· loading…' : `· ${visibleEntries.length} entries`}</h3>
        {visibleEntries.length === 0 && !loading ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>No entries yet. Add one above or run the seed script.</div>
        ) : (
          <>
          {/* Mobile: stacked rows (the table overflows a phone width). */}
          <div className="block md:hidden">
            {visibleEntries.map((e, i) => (
              <div key={e.entryId} style={{ padding: '14px 0', borderTop: i > 0 ? '1px solid var(--line)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{e.date}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => toggleEnabled(e)} style={{ ...pill, background: e.enabled ? 'var(--accentSoft)' : 'var(--surface2)', color: e.enabled ? 'var(--accentDeep)' : 'var(--muted)', cursor: 'pointer', border: 0 }}>
                      {e.enabled ? 'Published' : 'Draft'}
                    </button>
                    {e.kind === 'class' && (
                      <button onClick={() => togglePrasadNeeded(e)} style={{ ...pill, background: e.prasadNeeded ? 'var(--accentSoft)' : 'var(--surface2)', color: e.prasadNeeded ? 'var(--accentDeep)' : 'var(--muted)', cursor: 'pointer', border: 0 }}>
                        {e.prasadNeeded ? 'Prasad' : 'No prasad'}
                      </button>
                    )}
                    <button onClick={() => remove(e)} style={removeBtn} aria-label="Delete entry">×</button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
                  <span style={{ ...pill, background: e.kind === 'class' ? 'var(--accentSoft)' : 'var(--surface2)', color: e.kind === 'class' ? 'var(--accentDeep)' : 'var(--muted)' }}>
                    {e.kind === 'class' ? 'Class' : 'No class'}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--body-text)' }}>{e.kind === 'class' ? e.classType : e.noClassReason ?? '—'}</span>
                </div>
                {e.specialEvents && (
                  <div style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 6, lineHeight: 1.45 }}>{e.specialEvents}</div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: full table. */}
          <div className="hidden md:block" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)' }}>
                  {['Date', 'Kind', 'Detail', 'Special events', 'Status', ''].map((h) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((e) => (
                  <tr key={e.entryId} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={td}>{e.date}</td>
                    <td style={td}>{e.kind}</td>
                    <td style={td}>{e.kind === 'class' ? e.classType : e.noClassReason ?? '—'}</td>
                    <td style={{ ...td, color: 'var(--body-text)' }}>{e.specialEvents ?? '—'}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => toggleEnabled(e)} style={{ ...pill, background: e.enabled ? 'var(--accentSoft)' : 'var(--surface2)', color: e.enabled ? 'var(--accentDeep)' : 'var(--muted)', cursor: 'pointer', border: 0 }}>
                          {e.enabled ? 'Published' : 'Draft'}
                        </button>
                        {e.kind === 'class' && (
                          <button onClick={() => togglePrasadNeeded(e)} style={{ ...pill, background: e.prasadNeeded ? 'var(--accentSoft)' : 'var(--surface2)', color: e.prasadNeeded ? 'var(--accentDeep)' : 'var(--muted)', cursor: 'pointer', border: 0 }}>
                            {e.prasadNeeded ? 'Prasad' : 'No prasad'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={td}><button onClick={() => remove(e)} style={removeBtn} aria-label="Delete entry">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'flex', flexDirection: 'column', gap: 6 };
const fieldStyle: React.CSSProperties = { padding: '8px 10px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--body)', boxSizing: 'border-box', width: '100%' };
const toolbarStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' };
const toolbarFieldsStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' };
const addEntryButtonStyle: React.CSSProperties = { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '9px 16px', minHeight: 44 };
const checkboxLabelStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 40, fontSize: 13, fontWeight: 600, color: 'var(--ink)', gridColumn: '1 / -1' };
const checkboxStyle: React.CSSProperties = { width: 18, height: 18, accentColor: 'var(--accent)' };
const dialogActionsStyle: React.CSSProperties = { gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 };
const secondaryButtonStyle: React.CSSProperties = { fontSize: 13, padding: '8px 18px', minHeight: 40, border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' };
const td: React.CSSProperties = { padding: '10px 10px', verticalAlign: 'middle' };
const pill: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 };
const removeBtn: React.CSSProperties = { background: 'transparent', border: 0, color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: '0 6px' };
const linkBtn: React.CSSProperties = { background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 };
