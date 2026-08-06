'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHILD_GRADE_OPTIONS } from '@cmt/shared-domain';
import { toast } from '@cmt/ui';

/**
 * Record a walk-in visitor from the front desk.
 *
 * Vaibhav, 2026-08-05: *"Visitor management - add/update"*. The kiosk could
 * always capture a guest; the desk could only watch the board. This posts the
 * same document to the same place, so the visitor appears in the list below and
 * on the matching teacher's screen.
 *
 * `date` is the Sunday the board is currently showing, not today. Without it a
 * desk reviewing another week would type someone in and watch them not appear.
 */
export function AddVisitorForm({ date }: { date: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [numberOfAdults, setNumberOfAdults] = useState('1');
  // Children start EMPTY. An adults-only visit is a real case the schema
  // allows, and pre-seeding a blank row would make every such visit require
  // the person to delete something first.
  const [children, setChildren] = useState<Array<{ name: string; grade: string }>>([]);

  function reset() {
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setNumberOfAdults('1');
    setChildren([]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/welcome/visitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          numberOfAdults: Number(numberOfAdults) || 0,
          // Drop half-filled rows rather than sending them: the server requires
          // both fields on a child, so an abandoned row would 400 the whole
          // visit and lose the rest of what they typed.
          children: children.filter((c) => c.name.trim() !== '' && c.grade !== ''),
          date,
        }),
      });
      if (res.ok) {
        toast.success('Visitor added');
        reset();
        setOpen(false);
        // The list is server-rendered; refresh re-reads it so the new row shows
        // up under the class its grade matches.
        router.refresh();
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(
        json.error === 'bad-request'
          ? 'Please check the name, email, phone and each child’s grade.'
          : 'Could not add the visitor. Please try again.',
      );
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn--p"
        data-testid="add-visitor-open"
        onClick={() => setOpen(true)}
        style={{ alignSelf: 'flex-start' }}
      >
        Add visitor
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 16 }} data-testid="add-visitor-form">
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Add a visitor</h2>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
        Recorded for {date}. Email and phone are required so the family can be reached and can
        claim their account later.
      </p>

      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="v-first">First name</label>
          <input id="v-first" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="v-last">Last name</label>
          <input id="v-last" className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="v-email">Email</label>
          <input id="v-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="v-phone">Phone</label>
          <input id="v-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
      </div>

      <div className="field" style={{ marginBottom: 12, maxWidth: 160 }}>
        <label htmlFor="v-adults">Adults</label>
        <input
          id="v-adults"
          className="input"
          type="number"
          min={0}
          value={numberOfAdults}
          onChange={(e) => setNumberOfAdults(e.target.value)}
        />
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>Children</label>
        {children.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
            None yet. A visit with no children is fine.
          </p>
        )}
        {children.map((c, i) => (
          <div key={i} className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              aria-label={`Child ${i + 1} name`}
              placeholder="Name"
              value={c.name}
              onChange={(e) =>
                setChildren((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
              style={{ flex: 1 }}
            />
            <select
              className="input"
              aria-label={`Child ${i + 1} grade`}
              value={c.grade}
              onChange={(e) =>
                setChildren((prev) => prev.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))
              }
              style={{ flex: 1 }}
            >
              <option value="">Grade…</option>
              {CHILD_GRADE_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--g"
              aria-label={`Remove child ${i + 1}`}
              onClick={() => setChildren((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn--g"
          data-testid="add-child-row"
          onClick={() => setChildren((prev) => [...prev, { name: '', grade: '' }])}
        >
          Add a child
        </button>
        {/* Said here rather than after the fact: a child with no grade matches
            no class, so no teacher sees them - which is what the "Not matched
            to a class" bucket below is full of. */}
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          A child with no grade will not appear on any class list.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn--p" disabled={saving}>
          {saving ? 'Adding…' : 'Add visitor'}
        </button>
        <button type="button" className="btn btn--g" onClick={() => { reset(); setOpen(false); }} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
