'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot, SectionLabel, DesktopSidebar } from '@/features/family/components/atoms';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';

type MemberType = 'Adult' | 'Child';
type Gender = 'Male' | 'Female' | 'PreferNotToSay';

export default function AddMemberPage() {
  const router = useRouter();
  const [mode, setMode] = useState<MemberType>('Child');
  const [sidebarDisplayName, setSidebarDisplayName] = useState<string | undefined>();
  const [sidebarSubtitle, setSidebarSubtitle] = useState<string | undefined>();

  useEffect(() => {
    getCurrentFamilyClient().then((data) => {
      if (!data) return;
      const currentMember = data.members.find((m) => m.mid === data.currentMid);
      if (currentMember) {
        setSidebarDisplayName(`${currentMember.firstName} ${currentMember.lastName}`);
      }
      setSidebarSubtitle(`${data.family.name}${data.family.legacyFid ? ` · FID ${data.family.fid} · Legacy ${data.family.legacyFid}` : ` · FID ${data.family.fid}`}`);
    }).catch(() => { /* non-fatal */ });
  }, []);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<Gender>('Male');
  const [schoolGrade, setSchoolGrade] = useState('');
  const [birthMonthYear, setBirthMonthYear] = useState('');
  const [foodAllergies, setFoodAllergies] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [volunteeringSkills, setVolunteeringSkills] = useState('');
  const [ec1Relation, setEc1Relation] = useState('');
  const [ec1Phone, setEc1Phone] = useState('');
  const [ec1Email, setEc1Email] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const body = {
      firstName,
      lastName,
      type: mode,
      gender,
      schoolGrade: schoolGrade || null,
      birthMonthYear: birthMonthYear || null,
      foodAllergies: foodAllergies || null,
      volunteeringSkills: volunteeringSkills
        ? volunteeringSkills.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      email: email || null,
      phone: phone || null,
      emergencyContacts: [
        ec1Relation ? { relation: ec1Relation, phone: ec1Phone, email: ec1Email } : null,
        null,
      ],
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
    const msg = (json as { error?: string }).error ?? 'Failed to add member';
    setError(msg);
    setSaving(false);
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
              <input className="input" value={birthMonthYear} onChange={(e) => setBirthMonthYear(e.target.value)} placeholder="e.g. Mar 2017"/>
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
            <input className="input" value={volunteeringSkills} onChange={(e) => setVolunteeringSkills(e.target.value)} placeholder="e.g. Teaching, AV (comma-separated)"/>
          </div>
        </>
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

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="family" displayName={sidebarDisplayName} subtitle={sidebarSubtitle} showSignOut/>
          <main style={{ flex: 1, padding: '32px 48px', overflow: 'auto' }}>
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
          </main>
        </CspRoot>
      </div>
    </form>
  );
}
