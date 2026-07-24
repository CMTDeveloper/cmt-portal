'use client';
import { useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import { CHILD_GRADE_OPTIONS } from '@cmt/shared-domain';
import { handleKioskAuthExpiry } from './kiosk-auth';

interface ChildRow {
  name: string;
  grade: string;
}

// Native <select> styled to match @cmt/ui <Input> (no Select primitive in the
// shared kit). Kept in one place so every grade dropdown here looks identical.
const selectClass =
  'border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

export function GuestCheckInForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [adults, setAdults] = useState('1');
  const [children, setChildren] = useState<ChildRow[]>([]);

  function addChild() {
    setChildren((rows) => [...rows, { name: '', grade: '' }]);
  }
  function removeChild(i: number) {
    setChildren((rows) => rows.filter((_, idx) => idx !== i));
  }
  function updateChild(i: number, field: keyof ChildRow, value: string) {
    setChildren((rows) => rows.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const cleanedChildren = children.map((c) => ({ name: c.name.trim(), grade: c.grade.trim() }));
    if (cleanedChildren.some((c) => !c.name || !c.grade)) {
      setError('Give each child a name and a grade, or remove the empty row.');
      return;
    }

    const payload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      numberOfAdults: Number(adults) || 0,
      children: cleanedChildren,
    };
    setPending(true);
    try {
      const res = await fetch('/api/check-in/guests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (handleKioskAuthExpiry(res)) return;
      if (!res.ok) {
        setError('Check-in failed. Try again.');
        return;
      }
      setDone(true);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Thank you!</h2>
        <p className="mt-2 text-[hsl(var(--foreground))]">Your guest check-in has been recorded.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Guest check-in</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="adults">Adults</Label>
        <Input
          id="adults"
          name="adults"
          type="number"
          min="0"
          value={adults}
          onChange={(e) => setAdults(e.target.value)}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Children</Label>
          <button
            type="button"
            onClick={addChild}
            className="text-sm font-semibold text-[hsl(var(--primary))] underline-offset-2 hover:underline"
          >
            + Add child
          </button>
        </div>

        {children.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Add each child with their name and grade so their teacher can see them.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {children.map((child, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`child-name-${i}`}>Name</Label>
                  <Input
                    id={`child-name-${i}`}
                    aria-label={`Child ${i + 1} name`}
                    value={child.name}
                    onChange={(e) => updateChild(i, 'name', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`child-grade-${i}`}>Grade</Label>
                  <select
                    id={`child-grade-${i}`}
                    aria-label={`Child ${i + 1} grade`}
                    className={selectClass}
                    value={child.grade}
                    onChange={(e) => updateChild(i, 'grade', e.target.value)}
                  >
                    <option value="">Select grade</option>
                    {CHILD_GRADE_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => removeChild(i)}
                  aria-label={`Remove child ${i + 1}`}
                  className="mb-1 px-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Checking in…' : 'Check in as guest'}
      </Button>
    </form>
  );
}
