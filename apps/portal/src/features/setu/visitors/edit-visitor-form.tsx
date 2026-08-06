'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHILD_GRADE_OPTIONS, gradeLabel, normalizeGrade } from '@cmt/shared-domain';
import { toast } from '@cmt/ui';

/**
 * Correct one guest child already on the board (#130).
 *
 * Vaibhav asked for "visitor management - add/update"; only add shipped. This is
 * the half that matters: a child's `grade` is the ONLY thing routing them to a
 * teacher, so a wrong or missing one means nobody is expecting that child. The
 * "Not matched to a class" section on this page is that failure, listed.
 *
 * ── Why the form carries `expected` ─────────────────────────────────────────
 * A guest child's address is its POSITION in the visit document's `children`
 * array - those elements have no id. So the save sends back the values the desk
 * was shown, and the server refuses if the document has moved on. Two people
 * working the desk on a Sunday morning is the normal case, not an exotic one.
 */

export interface EditableVisitor {
  docId: string;
  childIndex: number;
  /** As currently stored - the compare-and-swap baseline AND the form's initial
   *  values. A blank grade is legal here and is the case worth fixing. */
  name: string;
  grade: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/** One message per server reason. A single "could not save" would leave the desk
 *  unable to tell "someone beat you to it" from "this row cannot be edited". */
const FAILURE_COPY: Record<string, string> = {
  changed: 'Someone else changed this visitor while you were editing. Refresh and try again.',
  'not-found': 'This visit no longer exists. Refresh the page.',
  'index-out-of-range': 'This visitor is no longer part of that visit. Refresh the page.',
  'no-children': 'This is an older visit record with no child details to correct.',
  forbidden: 'You do not have permission to correct visitors.',
  'bad-request': 'Please check the name, grade, email and phone.',
};

/**
 * The dropdown value for a stored grade, or '' when none applies.
 *
 * Stored grades are not always canonical tokens - 'Grade 2' and '2' are the same
 * class to `guestMatchesLevel`, which normalizes both sides. Matching on the raw
 * string would leave a perfectly matchable child sitting on the "please choose"
 * placeholder, and a Save would then be the desk "fixing" something that was
 * never broken.
 */
function canonicalGrade(stored: string): string {
  if (stored === '') return '';
  const target = normalizeGrade(stored);
  return CHILD_GRADE_OPTIONS.find((g) => normalizeGrade(g.value) === target)?.value ?? '';
}

export function EditVisitorForm({ visitor, siblingCount }: { visitor: EditableVisitor; siblingCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(visitor.name);
  // Seeded with the CANONICAL option matching what is stored, not the raw value.
  // A guest recorded as 'Grade 2' matches a class perfectly well (the matcher
  // normalizes both sides), so the select must land on "Grade 2" rather than
  // fall through to the placeholder and imply the row is broken.
  const [grade, setGrade] = useState(canonicalGrade(visitor.grade));
  const [firstName, setFirstName] = useState(visitor.firstName);
  const [lastName, setLastName] = useState(visitor.lastName);
  const [email, setEmail] = useState(visitor.email);
  const [phone, setPhone] = useState(visitor.phone);

  function cancel() {
    // Back to what is STORED, not to whatever was last typed: reopening the form
    // must show the row as it actually is, or the next save's `expected` would
    // be built from abandoned edits.
    setName(visitor.name);
    setGrade(canonicalGrade(visitor.grade));
    setFirstName(visitor.firstName);
    setLastName(visitor.lastName);
    setEmail(visitor.email);
    setPhone(visitor.phone);
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/welcome/visitors', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: visitor.docId,
          childIndex: visitor.childIndex,
          // What we were shown, verbatim - the server compares against this.
          expected: { name: visitor.name, grade: visitor.grade },
          child: { name: name.trim(), grade },
          contact: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            phone: phone.trim(),
          },
        }),
      });
      if (res.ok) {
        toast.success('Visitor updated');
        setOpen(false);
        // Server-rendered board: refresh re-reads it, so a corrected grade moves
        // the child out of "Not matched to a class" and under their real class.
        router.refresh();
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(FAILURE_COPY[json.error ?? ''] ?? 'Could not update the visitor. Please try again.');
    } catch {
      toast.error('Network error - please try again');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn--g"
        data-testid="edit-visitor-open"
        onClick={() => setOpen(true)}
        style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
      >
        Edit
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      data-testid="edit-visitor-form"
      style={{
        // `1 0 100%`, not `width: 100%`: the row above is a wrapping flex
        // container, so this is what makes the open form take a line of its own
        // instead of being squeezed into the grade column.
        flex: '1 0 100%', padding: 12, marginTop: 8,
        border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', background: 'var(--surface2)',
      }}
    >
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`ev-name-${visitor.docId}-${visitor.childIndex}`}>Child name</label>
          <input
            id={`ev-name-${visitor.docId}-${visitor.childIndex}`}
            className="input"
            data-testid="edit-visitor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`ev-grade-${visitor.docId}-${visitor.childIndex}`}>Grade</label>
          <select
            id={`ev-grade-${visitor.docId}-${visitor.childIndex}`}
            className="input"
            data-testid="edit-visitor-grade"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            required
          >
            {/* Present ONLY while no canonical option applies - i.e. the stored
                grade is blank or is junk no class could match. Disabled, so it
                can never be selected BACK: re-saving an unmatchable grade would
                re-hide the child from every teacher, which is the bug this
                screen exists to fix. */}
            {grade === '' && (
              <option value="" disabled>
                {visitor.grade
                  ? `${gradeLabel(visitor.grade)} - matches no class, please choose`
                  : 'No grade - please choose'}
              </option>
            )}
            {CHILD_GRADE_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`ev-first-${visitor.docId}-${visitor.childIndex}`}>Parent first name</label>
          <input
            id={`ev-first-${visitor.docId}-${visitor.childIndex}`}
            className="input"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`ev-last-${visitor.docId}-${visitor.childIndex}`}>Parent last name</label>
          <input
            id={`ev-last-${visitor.docId}-${visitor.childIndex}`}
            className="input"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`ev-email-${visitor.docId}-${visitor.childIndex}`}>Email</label>
          <input
            id={`ev-email-${visitor.docId}-${visitor.childIndex}`}
            className="input"
            type="email"
            data-testid="edit-visitor-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`ev-phone-${visitor.docId}-${visitor.childIndex}`}>Phone</label>
          <input
            id={`ev-phone-${visitor.docId}-${visitor.childIndex}`}
            className="input"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Said BEFORE they save, not after. The contact belongs to the visit, so
          editing it here necessarily changes it for that visit's other children.
          Only shown when there actually are any - an always-on caveat is noise. */}
      {siblingCount > 0 && (
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>
          The contact is shared with {siblingCount === 1 ? 'the other child' : `the other ${siblingCount} children`} who
          checked in on this visit, so changing it here updates {siblingCount === 1 ? 'theirs' : 'theirs'} too.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn--p" data-testid="edit-visitor-save" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn--g" onClick={cancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
