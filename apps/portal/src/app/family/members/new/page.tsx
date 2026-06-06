'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { VolunteeringSkillsPicker } from '@/features/setu/members/volunteering-skills-picker';

type MemberType = 'Adult' | 'Child';
type Gender = 'Male' | 'Female' | 'PreferNotToSay';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export default function AddMemberPage() {
  const router = useRouter();
  const [mode, setMode] = useState<MemberType>('Child');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<Gender>('Male');
  const [schoolGrade, setSchoolGrade] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [foodAllergies, setFoodAllergies] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [volunteeringSkills, setVolunteeringSkills] = useState<string[]>([]);
  const [ec1Relation, setEc1Relation] = useState('');
  const [ec1Phone, setEc1Phone] = useState('');
  const [ec1Email, setEc1Email] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Birth month/year is captured via two dropdowns and composed into the
  // existing "MMM YYYY" string (e.g. "Mar 2017") so stored data stays compatible.
  const currentYear = new Date().getFullYear();
  const birthYears = Array.from({ length: 26 }, (_, i) => String(currentYear - i));
  const birthMonthYear = birthMonth && birthYear ? `${birthMonth} ${birthYear}` : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      foodAllergies: foodAllergies || null,
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
    };
    return map[code] ?? 'Couldn\'t add the member. Please try again.';
  }

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
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required/>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Last name <span className="req">·</span></label>
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required/>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Gender <span className="req">·</span></label>
        <select className="input" value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="PreferNotToSay">Prefer not to say</option>
        </select>
      </div>

      {mode === 'Child' && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>School grade</label>
              <input className="input" value={schoolGrade} onChange={(e) => setSchoolGrade(e.target.value)} placeholder="e.g. Grade 3"/>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Birth month/year</label>
              <div className="row" style={{ gap: 8 }}>
                <select className="input" aria-label="Birth month" value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Month</option>
                  {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="input" aria-label="Birth year" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Year</option>
                  {birthYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>Food allergies</label>
            <input className="input" value={foodAllergies} onChange={(e) => setFoodAllergies(e.target.value)} placeholder="e.g. Peanuts"/>
          </div>
        </>
      )}

      {mode === 'Adult' && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}/>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Phone</label>
              <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}/>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Volunteering skills</label>
            <VolunteeringSkillsPicker value={volunteeringSkills} onChange={setVolunteeringSkills} />
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
