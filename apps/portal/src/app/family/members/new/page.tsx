'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CHILD_GRADE_OPTIONS, NO_ALLERGIES, whatsMissingForMember, type MemberRequiredField } from '@cmt/shared-domain';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { VolunteeringSkillsPicker } from '@/features/setu/members/volunteering-skills-picker';

type MemberType = 'Adult' | 'Child';
// Capture forms only ever offer Male|Female. The read-doc schema keeps
// 'PreferNotToSay' for the 3 internal sentinel paths, but humans never pick it.
type Gender = 'Male' | 'Female';

// Month dropdown carries the numeric value (1-12) so we can persist both the
// canonical birthMonthYear ('YYYY-MM') and the derived birthMonth (1-12).
const MONTHS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

export default function AddMemberPage() {
  const router = useRouter();
  const [mode, setMode] = useState<MemberType>('Child');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // No default gender — the member must actively choose Male or Female (the
  // profile-completion matrix treats an unselected gender as missing).
  const [gender, setGender] = useState<'' | Gender>('');
  const [schoolGrade, setSchoolGrade] = useState('');
  const [birthMonth, setBirthMonth] = useState(''); // numeric value as string ('1'..'12')
  const [birthYear, setBirthYear] = useState('');
  const [foodAllergies, setFoodAllergies] = useState('');
  const [noAllergies, setNoAllergies] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [volunteeringSkills, setVolunteeringSkills] = useState<string[]>([]);
  const [ec1Relation, setEc1Relation] = useState('');
  const [ec1Phone, setEc1Phone] = useState('');
  const [ec1Email, setEc1Email] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // Canonical 'YYYY-MM' from the two dropdowns + the derived birthMonth (1-12).
  const monthNum = birthMonth ? Number(birthMonth) : null;
  const birthMonthYear = monthNum && birthYear ? `${birthYear}-${String(monthNum).padStart(2, '0')}` : '';

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1-12
  const birthYears = Array.from({ length: 26 }, (_, i) => String(currentYear - i));
  // A child can't be born in the future: when the current year is selected, only
  // offer months up to the current month.
  const availableMonths = birthYear === String(currentYear) ? MONTHS.filter((m) => m.value <= currentMonth) : MONTHS;

  // The effective foodAllergies value: the "No known allergies" toggle wins and
  // writes the NO_ALLERGIES sentinel ('None') so the required field is satisfied
  // without forcing the user to invent an allergy.
  const effectiveAllergies = noAllergies ? NO_ALLERGIES : foodAllergies.trim();

  // Single source of truth for "what's still missing" — the same shared helper
  // the write routes + gate use, so the form blocks exactly what the server would.
  const missing: MemberRequiredField[] = whatsMissingForMember({
    type: mode,
    firstName,
    lastName,
    gender: gender || null,
    foodAllergies: effectiveAllergies || null,
    email: email || null,
    phone: phone || null,
    volunteeringSkills,
    schoolGrade: schoolGrade || null,
    birthMonthYear: birthMonthYear || null,
  });
  const isMissing = (f: MemberRequiredField) => missing.includes(f);
  const canSubmit = missing.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setError(null);

    // Build the emergency contact object only when at least one field is
    // filled. If only relation is filled, phone/email become empty strings
    // which the server accepts (schema treats them as optional).
    const ec1Trim = {
      relation: ec1Relation.trim(),
      phone: ec1Phone.trim(),
      email: ec1Email.trim(),
    };
    const ec1Empty = !ec1Trim.relation && !ec1Trim.phone && !ec1Trim.email;
    const ec1 = ec1Empty ? null : ec1Trim;

    const body = {
      firstName,
      lastName,
      type: mode,
      gender,
      schoolGrade: schoolGrade || null,
      birthMonthYear: birthMonthYear || null,
      birthMonth: monthNum, // derived (1-12) so prasad + grade ladder stay in sync
      foodAllergies: effectiveAllergies || null,
      volunteeringSkills,
      email: email || null,
      phone: phone || null,
      emergencyContacts: [ec1, null],
    };

    const res = await fetch('/api/setu/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      router.push('/family/members');
      return;
    }

    const json = await res.json().catch(() => ({}));
    const data = json as { error?: string; issues?: Array<{ path?: string[]; message?: string }>; field?: string };
    setError(friendlyError(data));
    setSaving(false);
  }

  function friendlyError(data: { error?: string; issues?: Array<{ path?: string[]; message?: string }>; field?: string }): string {
    const code = data.error ?? 'unknown';
    if (code === 'bad-request' && Array.isArray(data.issues) && data.issues.length > 0) {
      // Surface the specific zod issue(s) so the user knows what to fix.
      const issues = data.issues
        .map((i) => {
          const field = (i.path ?? []).join('.') || 'field';
          return `${field}: ${i.message ?? 'invalid'}`;
        })
        .join(' · ');
      return `Some fields look off — ${issues}`;
    }
    if (code === 'contact-already-registered') {
      const field = data.field ?? 'contact';
      return `This ${field} is already linked to another family. Use a different ${field}.`;
    }
    const map: Record<string, string> = {
      'bad-request': 'Please check your inputs and try again.',
      'no-session': 'Your session expired. Please sign in again.',
      'manager-required': 'Only family managers can add members.',
      'family-not-found': 'We couldn\'t find your family record. Try signing in again.',
      'skills-required': 'Adults need at least one volunteering skill.',
      'contact-required': 'Adults need both an email and a phone number.',
      'foodAllergies-required': 'Please record food allergies (or pick “No known allergies”).',
      'grade-required': 'Children need a school grade.',
      'birthmonth-required': 'Children need a birth month and year.',
    };
    return map[code] ?? 'Couldn\'t add the member. Please try again.';
  }

  const reqError = (f: MemberRequiredField, label: string) =>
    showErrors && isMissing(f) ? (
      <p style={{ fontSize: 12, color: 'var(--err)', marginTop: 6 }}>{label}</p>
    ) : null;

  const formBody = (
    <>
      {error && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fff3ec', border: '1px solid var(--err)', borderRadius: 'var(--radiusSm)', color: 'var(--err)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="field" style={{ marginBottom: 16 }}>
        <label>Member type <span className="req">·</span></label>
        <div className="row" style={{ gap: 8 }}>
          {(['Adult', 'Child'] as MemberType[]).map((m) => {
            const active = m === mode;
            return (
              <button key={m} type="button" onClick={() => setMode(m)} style={{
                flex: 1, padding: '12px',
                border: '1px solid', borderColor: active ? 'var(--accent)' : 'var(--line2)',
                background: active ? 'var(--accentSoft)' : 'var(--surface)',
                color: active ? 'var(--accentDeep)' : 'var(--body-text)',
                fontWeight: 600, fontSize: 14, borderRadius: 'var(--radiusSm)',
              }}>{m}</button>
            );
          })}
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>First name <span className="req">·</span></label>
          <input className="input" aria-label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)}/>
          {reqError('firstName', 'First name is required')}
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Last name <span className="req">·</span></label>
          <input className="input" aria-label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)}/>
          {reqError('lastName', 'Last name is required')}
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Gender <span className="req">·</span></label>
        <select className="input" value={gender} onChange={(e) => setGender(e.target.value as '' | Gender)}>
          <option value="">Select…</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
        {reqError('gender', 'Please select a gender')}
      </div>

      {/* Food allergies — required for ALL members (issue #16). The "No known
          allergies" toggle satisfies the requirement with the NO_ALLERGIES sentinel. */}
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Food allergies <span className="req">·</span></label>
        <input
          className="input"
          value={foodAllergies}
          onChange={(e) => setFoodAllergies(e.target.value)}
          placeholder="e.g. Peanuts"
          disabled={noAllergies}
          aria-label="Food allergies"
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--body-text)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            data-testid="no-allergies"
            checked={noAllergies}
            onChange={(e) => {
              setNoAllergies(e.target.checked);
              if (e.target.checked) setFoodAllergies('');
            }}
            style={{ width: 16, height: 16 }}
          />
          No known allergies
        </label>
        {reqError('foodAllergies', 'Record allergies or check “No known allergies”')}
      </div>

      {mode === 'Child' && (
        <>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>School grade <span className="req">·</span></label>
            <select className="input" aria-label="School grade" value={schoolGrade} onChange={(e) => setSchoolGrade(e.target.value)}>
              <option value="" disabled>Select grade…</option>
              {CHILD_GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
            {reqError('schoolGrade', 'School grade is required')}
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Birth month/year <span className="req">·</span></label>
            <div className="row" style={{ gap: 8 }}>
              <select className="input" aria-label="Birth month" value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} style={{ flex: 1 }}>
                <option value="">Month</option>
                {availableMonths.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select className="input" aria-label="Birth year" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} style={{ flex: 1 }}>
                <option value="">Year</option>
                {birthYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {reqError('birthMonthYear', 'Birth month and year are required')}
          </div>
        </>
      )}

      {mode === 'Adult' && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Email <span className="req">·</span></label>
              <input className="input" aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}/>
              {reqError('email', 'Email is required for adults')}
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Phone <span className="req">·</span></label>
              <input className="input" aria-label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}/>
              {reqError('phone', 'Phone is required for adults')}
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Volunteering skills <span className="req">·</span></label>
            <VolunteeringSkillsPicker value={volunteeringSkills} onChange={setVolunteeringSkills} />
            {reqError('volunteeringSkills', 'Select at least one volunteering skill')}
          </div>
        </>
      )}

      <SectionLabel>Emergency contact (optional)</SectionLabel>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6, marginBottom: 8 }}>
        Someone we can reach if we can&apos;t reach the member directly. Skip this section if you don&apos;t want to add one.
      </p>
      <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Relation</label>
          <input className="input" value={ec1Relation} onChange={(e) => setEc1Relation(e.target.value)} placeholder="e.g. Mother, Spouse, Neighbour"/>
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Their phone</label>
          <input className="input" type="tel" value={ec1Phone} onChange={(e) => setEc1Phone(e.target.value)} placeholder="(416) 555-0000"/>
        </div>
        <div className="field">
          <label>Their email</label>
          <input className="input" type="email" value={ec1Email} onChange={(e) => setEc1Email(e.target.value)} placeholder="contact@example.com"/>
        </div>
      </div>
    </>
  );

  return (
    <form onSubmit={handleSubmit}>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.x/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Add member</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 100px' }}>
              {formBody}
            </div>
            <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              <button type="submit" className="btn btn--p btn--block" disabled={saving}>
                {saving ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back/> Back to family
          </Link>
          <div className="between">
            <div>
              <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>Add member</h1>
            </div>
          </div>
        </header>

        <div style={{ maxWidth: 720 }}>
          {formBody}
          <div style={{ marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--line)', display: 'flex', gap: 10 }}>
            <button type="submit" className="btn btn--p" style={{ padding: '14px 28px' }} disabled={saving}>
              {saving ? 'Adding…' : 'Add member'}
            </button>
            <Link href="/family/members" className="btn btn--g">Cancel</Link>
          </div>
        </div>
      </div>
    </form>
  );
}
