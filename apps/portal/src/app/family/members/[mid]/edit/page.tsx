'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon, toast } from '@cmt/ui';
import { CspRoot, SectionLabel, FieldError } from '@/features/family/components/atoms';
import { VolunteeringSkillsPicker } from '@/features/setu/members/volunteering-skills-picker';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';
import { LoadingOm } from '@/components/chrome/loading-om';

type MemberType = 'Adult' | 'Child';
type Gender = 'Male' | 'Female' | 'PreferNotToSay';

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
  const [gender, setGender] = useState<Gender>('Male');
  const [schoolGrade, setSchoolGrade] = useState('');
  const [birthMonthYear, setBirthMonthYear] = useState('');
  const [foodAllergies, setFoodAllergies] = useState('');
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

  // isEditingOther: manager editing a different member's profile
  const isEditingOther = data ? (data.isManager && mid !== data.currentMid) : false;
  // showManagerToggle: only when a manager edits someone other than themselves
  const showManagerToggle = isEditingOther;
  // Adults must pick at least one volunteering skill (issue #10). Children
  // have no skills, so this never blocks a Child save.
  const skillsInvalid = type === 'Adult' && volunteeringSkills.length === 0;

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
        setGender(member.gender);
        setSchoolGrade(member.schoolGrade ?? '');
        setBirthMonthYear(member.birthMonthYear ?? '');
        setFoodAllergies(member.foodAllergies ?? '');
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
    setSaving(true);
    setFieldErrors({});

    const body: Record<string, unknown> = {
      firstName,
      lastName,
      type,
      gender,
      schoolGrade: schoolGrade || null,
      birthMonthYear: birthMonthYear || null,
      foodAllergies: foodAllergies || null,
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
        fields?: Record<string, string>;
      };

      if (json.fields && Object.keys(json.fields).length > 0) {
        setFieldErrors(json.fields as FieldErrors);
      } else {
        toast.error(json.error ?? 'Save failed');
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
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required/>
          <FieldError message={fieldErrors.firstName}/>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Last name <span className="req">·</span></label>
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required/>
          <FieldError message={fieldErrors.lastName}/>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Gender <span className="req">·</span></label>
        <select className="input" value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="PreferNotToSay">Prefer not to say</option>
        </select>
        <FieldError message={fieldErrors.gender}/>
      </div>

      {type === 'Child' && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>School grade</label>
              <input className="input" value={schoolGrade} onChange={(e) => setSchoolGrade(e.target.value)} placeholder="e.g. Grade 3"/>
              <FieldError message={fieldErrors.schoolGrade}/>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Birth month/year</label>
              <input className="input" value={birthMonthYear} onChange={(e) => setBirthMonthYear(e.target.value)} placeholder="e.g. Mar 2017"/>
              <FieldError message={fieldErrors.birthMonthYear}/>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Food allergies</label>
            <input className="input" value={foodAllergies} onChange={(e) => setFoodAllergies(e.target.value)} placeholder="e.g. Peanuts"/>
            <FieldError message={fieldErrors.foodAllergies}/>
          </div>
        </>
      )}

      {type === 'Adult' && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}/>
              <FieldError message={fieldErrors.email}/>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Phone</label>
              <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}/>
              <FieldError message={fieldErrors.phone}/>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Volunteering skills <span className="req">·</span></label>
            <VolunteeringSkillsPicker value={volunteeringSkills} onChange={setVolunteeringSkills} />
            {skillsInvalid && (
              <p style={{ fontSize: 12, color: 'var(--err)', marginTop: 6 }}>Select at least one</p>
            )}
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
              <button type="submit" className="btn btn--p btn--block" disabled={saving || loading || skillsInvalid}>
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
            <button type="submit" className="btn btn--p" style={{ padding: '14px 28px' }} disabled={saving || loading || skillsInvalid}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <Link href={`/family/members/${mid}`} className="btn btn--g">Cancel</Link>
          </div>
        </div>
      </div>
    </form>
  );
}
