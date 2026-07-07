'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon, toast } from '@cmt/ui';
import { CHILD_GRADE_OPTIONS, NO_ALLERGIES, whatsMissingForMember, type MemberRequiredField } from '@cmt/shared-domain';
import { CspRoot, SectionLabel, FieldError } from '@/features/family/components/atoms';
import { VolunteeringSkillsPicker } from '@/features/setu/members/volunteering-skills-picker';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import { memberWriteErrorMessage } from '@/features/setu/members/member-write-error';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';
import { LoadingOm } from '@/components/chrome/loading-om';

type MemberType = 'Adult' | 'Child';
// Capture forms only ever offer Male|Female. A legacy member carrying the
// 'PreferNotToSay' sentinel is mapped to no-selection on load so the manager
// must pick a real value (the write route rejects 'PreferNotToSay').
type Gender = 'Male' | 'Female';

// Month dropdown carries the numeric value (1-12) so we persist both the
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

// Parse a stored birthMonthYear into the month-value + year the dropdowns use.
// Canonical form is 'YYYY-MM'; we also tolerate a legacy 'MMM YYYY' shape so
// older docs don't render blank.
const LEGACY_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseBirthMonthYear(value: string): { month: string; year: string } {
  const iso = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (iso) {
    const m = Number(iso[2]);
    return { month: m >= 1 && m <= 12 ? String(m) : '', year: iso[1]! };
  }
  const legacy = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec(value.trim());
  if (legacy) {
    const idx = LEGACY_MONTHS.indexOf(legacy[1]!.toLowerCase());
    return { month: idx >= 0 ? String(idx + 1) : '', year: legacy[2]! };
  }
  return { month: '', year: '' };
}

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  gender?: string;
  schoolGrade?: string;
  birthMonthYear?: string;
  foodAllergies?: string;
}

export default function EditMemberPage() {
  const router = useRouter();
  const params = useParams<{ mid: string }>();
  const mid = params.mid;

  const [data, setData] = useState<FamilyWithMembers | null>(null);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [type, setType] = useState<MemberType>('Adult');
  const [gender, setGender] = useState<'' | Gender>('');
  const [schoolGrade, setSchoolGrade] = useState('');
  const [birthMonth, setBirthMonth] = useState(''); // numeric value as string ('1'..'12')
  const [birthYear, setBirthYear] = useState('');
  const [foodAllergies, setFoodAllergies] = useState('');
  const [noAllergies, setNoAllergies] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [volunteeringSkills, setVolunteeringSkills] = useState<string[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [ec1Relation, setEc1Relation] = useState('');
  const [ec1Phone, setEc1Phone] = useState('');
  const [ec1Email, setEc1Email] = useState('');
  const [ec2Relation, setEc2Relation] = useState('');
  const [ec2Phone, setEc2Phone] = useState('');
  const [ec2Email, setEc2Email] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);

  // isEditingOther: manager editing a different member's profile
  const isEditingOther = data ? (data.isManager && mid !== data.currentMid) : false;
  // showManagerToggle: only when a manager edits someone other than themselves
  const showManagerToggle = isEditingOther;

  // Canonical 'YYYY-MM' from the two dropdowns + the derived birthMonth (1-12).
  const monthNum = birthMonth ? Number(birthMonth) : null;
  const birthMonthYear = monthNum && birthYear ? `${birthYear}-${String(monthNum).padStart(2, '0')}` : '';
  const currentYear = new Date().getFullYear();
  const birthYears = Array.from({ length: 26 }, (_, i) => String(currentYear - i));

  // "No known allergies" wins and writes the NO_ALLERGIES sentinel ('None') so
  // the required food-allergies field is satisfied without inventing an allergy.
  const effectiveAllergies = noAllergies ? NO_ALLERGIES : foodAllergies.trim();

  // Single source of truth for "what's still missing" — the same shared helper
  // the write routes + gate use, so the form blocks exactly what the server would.
  const missing: MemberRequiredField[] = whatsMissingForMember({
    type,
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

  useEffect(() => {
    // Fetch via the API route — calling getCurrentFamily() directly from a
    // 'use client' component would crash at runtime (it uses next/headers +
    // firebase-admin, both server-only). getCurrentFamilyClient wraps the
    // GET /api/setu/family call so it's mockable in component tests.
    getCurrentFamilyClient()
      .then((result: FamilyWithMembers | null) => {
        if (!result) {
          setLoading(false);
          return;
        }
        const member = result.members.find((m) => m.mid === mid);
        if (!member) {
          setLoading(false);
          return;
        }
        setData(result);
        setFirstName(member.firstName);
        setLastName(member.lastName);
        setType(member.type);
        // Legacy 'PreferNotToSay' sentinel → no-selection (must pick Male/Female).
        setGender(member.gender === 'Male' || member.gender === 'Female' ? member.gender : '');
        setSchoolGrade(member.schoolGrade ?? '');
        const parsedBirth = parseBirthMonthYear(member.birthMonthYear ?? '');
        setBirthMonth(parsedBirth.month);
        setBirthYear(parsedBirth.year);
        const allergies = member.foodAllergies ?? '';
        if (allergies === NO_ALLERGIES) {
          setNoAllergies(true);
          setFoodAllergies('');
        } else {
          setFoodAllergies(allergies);
        }
        setEmail(member.email ?? '');
        setPhone(member.phone ?? '');
        setVolunteeringSkills(member.volunteeringSkills);
        setIsManager(member.manager);
        const [ec1, ec2] = member.emergencyContacts ?? [null, null];
        setEc1Relation(ec1?.relation ?? '');
        setEc1Phone(ec1?.phone ?? '');
        setEc1Email(ec1?.email ?? '');
        setEc2Relation(ec2?.relation ?? '');
        setEc2Phone(ec2?.phone ?? '');
        setEc2Email(ec2?.email ?? '');
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [mid]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    if (!canSubmit) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setFieldErrors({});

    const body: Record<string, unknown> = {
      firstName,
      lastName,
      type,
      gender,
      schoolGrade: schoolGrade || null,
      birthMonthYear: birthMonthYear || null,
      birthMonth: monthNum, // derived (1-12) so prasad + grade ladder stay in sync
      foodAllergies: effectiveAllergies || null,
      volunteeringSkills,
      email: email || null,
      phone: phone || null,
      emergencyContacts: [
        ec1Relation ? { relation: ec1Relation, phone: ec1Phone, email: ec1Email } : null,
        ec2Relation ? { relation: ec2Relation, phone: ec2Phone, email: ec2Email } : null,
      ],
    };

    if (showManagerToggle) {
      body.manager = isManager;
    }

    try {
      const res = await fetch(`/api/setu/members/${mid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push(`/family/members/${mid}`);
        return;
      }

      const json = await res.json().catch(() => ({})) as {
        error?: string;
        issues?: Array<{ path?: (string | number)[]; message?: string }>;
        field?: string;
        fields?: Record<string, string>;
      };

      if (json.fields && Object.keys(json.fields).length > 0) {
        setFieldErrors(json.fields as FieldErrors);
      } else {
        // The write routes return a top-level error CODE (never a `fields` map),
        // so map it to friendly copy rather than toasting e.g. "contact-required".
        toast.error(memberWriteErrorMessage(json));
      }
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!data) return;
    if (!confirm('Remove this member from the family?')) return;

    try {
      const res = await fetch(`/api/setu/members/${mid}`, { method: 'DELETE' });

      if (res.ok) {
        router.push('/family/members');
        return;
      }

      const json = await res.json().catch(() => ({})) as { error?: string };
      if (json.error === 'last-manager') {
        toast.error('Cannot remove the last manager from a family');
      } else {
        toast.error(json.error ?? 'Remove failed');
      }
    } catch {
      toast.error('Network error — please try again');
    }
  }

  // Member not found in family — show explicit message (notFound() not available in client components)
  if (!loading && (!data || !data.members.find((m) => m.mid === mid))) {
    return (
      <div style={{ padding: 32 }}>
        <h2>Member not found</h2>
        <p>This member may have been removed.</p>
        <Link href="/family/members">← Back to members</Link>
      </div>
    );
  }

  // Client-side required marker — shown only after a blocked submit attempt.
  const reqError = (f: MemberRequiredField, label: string) =>
    showErrors && isMissing(f) ? (
      <p style={{ fontSize: 12, color: 'var(--err)', marginTop: 6 }}>{label}</p>
    ) : null;

  const formBody = loading ? (
    <LoadingOm padding={40} />
  ) : (
    <>
      <div className="field" style={{ marginBottom: 16 }}>
        <label>Member type <span className="req">·</span></label>
        <div className="row" style={{ gap: 8 }}>
          {(['Adult', 'Child'] as MemberType[]).map((m) => {
            const active = m === type;
            return (
              <button key={m} type="button" onClick={() => setType(m)} style={{
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
          <FieldError message={fieldErrors.firstName}/>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Last name <span className="req">·</span></label>
          <input className="input" aria-label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)}/>
          <FieldError message={fieldErrors.lastName}/>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Gender <span className="req">·</span></label>
        <select className="input" value={gender} onChange={(e) => setGender(e.target.value as '' | Gender)}>
          <option value="">Select…</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
        <FieldError message={fieldErrors.gender}/>
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
        <FieldError message={fieldErrors.foodAllergies}/>
        {reqError('foodAllergies', 'Record allergies or check “No known allergies”')}
      </div>

      {type === 'Child' && (
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>School grade <span className="req">·</span></label>
            <select className="input" aria-label="School grade" value={schoolGrade} onChange={(e) => setSchoolGrade(e.target.value)}>
              <option value="" disabled>Select grade…</option>
              {CHILD_GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
            <FieldError message={fieldErrors.schoolGrade}/>
            {reqError('schoolGrade', 'School grade is required')}
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Birth month/year <span className="req">·</span></label>
            <div className="row" style={{ gap: 8 }}>
              <select className="input" aria-label="Birth month" value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} style={{ flex: 1 }}>
                <option value="">Month</option>
                {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select className="input" aria-label="Birth year" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} style={{ flex: 1 }}>
                <option value="">Year</option>
                {birthYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <FieldError message={fieldErrors.birthMonthYear}/>
            {reqError('birthMonthYear', 'Birth month and year are required')}
          </div>
        </div>
      )}

      {type === 'Adult' && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Email <span className="req">·</span></label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}/>
              <FieldError message={fieldErrors.email}/>
              {reqError('email', 'Email is required for adults')}
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Phone <span className="req">·</span></label>
              <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}/>
              <FieldError message={fieldErrors.phone}/>
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

      {showManagerToggle && (
        <div className="field" style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              data-testid="manager-toggle"
              checked={isManager}
              onChange={(e) => setIsManager(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Family manager (can add/edit/remove members)
          </label>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            Tip: you can also use “Make manager” on the My family page. Uncheck here to remove manager access.
          </p>
        </div>
      )}

      <SectionLabel>Emergency contact 1 <span className="req">·</span></SectionLabel>
      <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Relation</label>
          <input className="input" value={ec1Relation} onChange={(e) => setEc1Relation(e.target.value)} placeholder="e.g. Mother"/>
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Phone</label>
          <input className="input" type="tel" value={ec1Phone} onChange={(e) => setEc1Phone(e.target.value)}/>
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={ec1Email} onChange={(e) => setEc1Email(e.target.value)}/>
        </div>
      </div>

      <SectionLabel>Emergency contact 2</SectionLabel>
      <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Relation</label>
          <input className="input" value={ec2Relation} onChange={(e) => setEc2Relation(e.target.value)} placeholder="e.g. Father"/>
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Phone</label>
          <input className="input" type="tel" value={ec2Phone} onChange={(e) => setEc2Phone(e.target.value)}/>
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={ec2Email} onChange={(e) => setEc2Email(e.target.value)}/>
        </div>
      </div>

    </>
  );

  const removeButton = !loading && data?.isManager && mid !== data.currentMid ? (
    <button
      type="button"
      onClick={handleRemove}
      className="focus-ring"
      style={{ width: '100%', marginTop: 22, background: 'transparent', border: '1px solid var(--err)', color: 'var(--err)', padding: '12px 16px', borderRadius: 'var(--radiusSm)', fontWeight: 600, fontSize: 13 }}
    >
      Remove from family
    </button>
  ) : null;

  return (
    <form onSubmit={handleSubmit}>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href={`/family/members/${mid}`} className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.x/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Edit member</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 100px' }}>
              {formBody}
            </div>
            <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              <button type="submit" className="btn btn--p btn--block" disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <Link href={`/family/members/${mid}`} className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back/> Back to member
          </Link>
          <div className="between">
            <div>
              <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Edit member</p>
              <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>{firstName || '…'} {lastName}</h1>
            </div>
          </div>
        </header>

        <div style={{ maxWidth: 720 }}>
          {formBody}
          {removeButton}
          <div style={{ marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--line)', display: 'flex', gap: 10 }}>
            <button type="submit" className="btn btn--p" style={{ padding: '14px 28px' }} disabled={saving || loading}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <Link href={`/family/members/${mid}`} className="btn btn--g">Cancel</Link>
          </div>
        </div>
      </div>
    </form>
  );
}
