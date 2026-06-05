'use client';

import { Suspense, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast, SetuLogo, SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, StepHeader, AddedMemberRow } from '@/features/family/components/atoms';
import { flags } from '@/lib/flags';

// ─── Types ────────────────────────────────────────────────────────────────────

type Location = 'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham';
type Gender = 'Male' | 'Female' | 'PreferNotToSay';
type MemberType = 'Adult' | 'Child';

interface AdditionalMember {
  id: string;
  firstName: string;
  lastName: string;
  type: MemberType;
  gender: Gender;
  email?: string;
  phone?: string;
}

// ─── Flag-off fallback (visual-only prototype) ────────────────────────────────

function RegisterFamilyPrototype() {
  const formContent = (
    <>
      <StepHeader step={2} of={2} label="Family details"/>
      <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 18, marginBottom: 18 }}>Tell us about your family.</h1>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Family name <span className="req">·</span></label>
        <input className="input" type="text" defaultValue="Patel"/>
        <div className="hint">Used in greetings — "The Patel Family"</div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Primary location <span className="req">·</span></label>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const).map((l, i) => (
            <button key={i} className="pill" style={{
              padding: '8px 12px', fontSize: 13,
              background: i === 0 ? 'var(--accent)' : 'var(--surface)',
              color: i === 0 ? '#fff' : 'var(--body-text)',
              border: '1px solid', borderColor: i === 0 ? 'var(--accent)' : 'var(--line2)',
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="field" style={{ marginBottom: 18 }}>
        <label>I'm the family manager</label>
        <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
          <div className="row" style={{ gap: 10 }}>
            <SetuAvatar name="Raj Patel" size={40}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Raj Patel</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>raj.patel@gmail.com · (416) 555-2204</div>
            </div>
            <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Manager</span>
          </div>
          <button className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontWeight: 600, fontSize: 12, marginTop: 10, padding: 0 }}>
            Edit my details →
          </button>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 6 }}>
        <label>Add at least one family member</label>
      </div>
      <div className="col" style={{ gap: 10, marginBottom: 18 }}>
        <AddedMemberRow name="Aarti Patel" type="Adult · spouse"/>
        <AddedMemberRow name="Diya Patel" type="Child · Gr 3"/>
        <button className="focus-ring" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px', background: 'transparent', border: '1px dashed var(--line2)', borderRadius: 'var(--radius)', color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>
          <SetuIcon.plus/> Add another member
        </button>
      </div>

      <Link href="/family" className="btn btn--p btn--block" style={{ display: 'flex' }}>Create family & continue →</Link>
      <p style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
        You can edit anything after — this is just to get you started.
      </p>
    </>
  );

  return (
    <>
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', overflowY: 'auto' }}>
            <Link href="/register" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, marginBottom: 12, color: 'var(--body-text)', display: 'inline-flex' }}>
              <SetuIcon.back/>
            </Link>
            {formContent}
          </div>
        </CspRoot>
      </div>
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 'auto' }}>
              <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--body-text)', textDecoration: 'none', fontSize: 13, marginBottom: 40 }}>
                <SetuIcon.back/> Back
              </Link>
              <SetuLogo size={22}/>
            </div>
            <div style={{ maxWidth: 520, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
              {formContent}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
              <span>setu.chinmayatoronto.org</span>
              <span>·</span>
              <span>© 2026 CMT</span>
            </div>
          </div>
          <RightPane/>
        </CspRoot>
      </div>
    </>
  );
}

// ─── Right decorative pane (shared) ──────────────────────────────────────────

function RightPane() {
  return (
    <div style={{ flex: '1 1 0', background: 'var(--accent)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 48 }}>
      <div style={{ position: 'absolute', inset: 0, opacity: .15, display: 'grid', placeItems: 'center' }}>
        <Rosette size={520} color="#fff" stroke={.5}/>
      </div>
      <div style={{ position: 'relative', color: '#fff' }}>
        <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>Step 2 of 2</p>
        <p style={{ fontFamily: 'var(--display)', fontSize: 26, fontStyle: 'italic', lineHeight: 1.35, fontWeight: 400 }}>
          "Your family profile is the foundation — enrollment, attendance and receipts all flow from here."
        </p>
        <p style={{ marginTop: 16, fontSize: 13, opacity: .75, lineHeight: 1.55 }}>
          You can add or edit members at any time from the family dashboard.
        </p>
      </div>
    </div>
  );
}

// ─── Real register-family form ────────────────────────────────────────────────

function RegisterFamilyReal() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const phone = searchParams.get('phone') ?? '';

  const [familyName, setFamilyName] = useState('');
  const [location, setLocation] = useState<Location | null>(null);
  const [managerFirstName, setManagerFirstName] = useState('');
  const [managerLastName, setManagerLastName] = useState('');
  const [managerGender, setManagerGender] = useState<Gender>('PreferNotToSay');
  const [additionalMembers, setAdditionalMembers] = useState<AdditionalMember[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  // New-member draft state
  const [draftFirstName, setDraftFirstName] = useState('');
  const [draftLastName, setDraftLastName] = useState('');
  const [draftType, setDraftType] = useState<MemberType>('Adult');
  const [draftGender, setDraftGender] = useState<Gender>('PreferNotToSay');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftError, setDraftError] = useState('');

  const handleAddMember = useCallback(() => {
    if (!draftFirstName.trim() || !draftLastName.trim()) return;
    const email = draftEmail.trim();
    const phone = draftPhone.trim();
    // A member's email is optional, but if present it must look valid — otherwise
    // the server rejects the whole registration with a cryptic 400.
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setDraftError('Enter a valid email or leave it blank.');
      return;
    }
    setDraftError('');
    setAdditionalMembers(prev => [
      ...prev,
      {
        id: `${Date.now()}`,
        firstName: draftFirstName.trim(),
        lastName: draftLastName.trim(),
        type: draftType,
        gender: draftGender,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      },
    ]);
    setDraftFirstName('');
    setDraftLastName('');
    setDraftEmail('');
    setDraftPhone('');
    setDraftType('Adult');
    setDraftGender('PreferNotToSay');
    setShowAddMember(false);
  }, [draftFirstName, draftLastName, draftEmail, draftPhone, draftType, draftGender]);

  const handleRemoveMember = useCallback((id: string) => {
    setAdditionalMembers(prev => prev.filter(m => m.id !== id));
  }, []);

  async function handleSubmit() {
    setFieldErrors({});
    const errors: Record<string, string> = {};
    if (!familyName.trim()) errors.familyName = 'Family name is required.';
    if (!location) errors.location = 'Please select a primary location.';
    if (!managerFirstName.trim()) errors.managerFirstName = 'Your first name is required.';
    if (!managerLastName.trim()) errors.managerLastName = 'Your last name is required.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/setu/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          phone,
          familyName: familyName.trim(),
          location,
          manager: {
            firstName: managerFirstName.trim(),
            lastName: managerLastName.trim(),
            gender: managerGender,
          },
          additionalMembers: additionalMembers.map(({ firstName, lastName, type, gender, email, phone }) => ({
            firstName,
            lastName,
            type,
            gender,
            ...(email ? { email } : {}),
            ...(phone ? { phone } : {}),
          })),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; fields?: Record<string, string> };
        if (body.fields) {
          setFieldErrors(body.fields);
        } else {
          toast.error(body.error ?? 'Registration failed. Please try again.');
        }
        return;
      }

      const body = await res.json() as { redirectTo?: string };
      window.location.href = body.redirectTo ?? '/family';
    } catch {
      toast.error('Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const managerDisplayName = [managerFirstName, managerLastName].filter(Boolean).join(' ') || 'You';

  const formContent = (
    <>
      <StepHeader step={2} of={2} label="Family details"/>
      <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 18, marginBottom: 18 }}>Tell us about your family.</h1>

      {/* Family name */}
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Family name <span className="req">·</span></label>
        <input
          className="input"
          type="text"
          placeholder="e.g. Patel"
          value={familyName}
          onChange={e => setFamilyName(e.target.value)}
          disabled={submitting}
          aria-invalid={!!fieldErrors.familyName}
        />
        <div className="hint">Used in greetings — "The {familyName || 'Family'} Family"</div>
        {fieldErrors.familyName && <div className="field-error" role="alert">{fieldErrors.familyName}</div>}
      </div>

      {/* Location */}
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Primary location <span className="req">·</span></label>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const).map(l => (
            <button
              key={l}
              className="pill"
              onClick={() => setLocation(l)}
              disabled={submitting}
              style={{
                padding: '8px 12px', fontSize: 13,
                background: location === l ? 'var(--accent)' : 'var(--surface)',
                color: location === l ? '#fff' : 'var(--body-text)',
                border: '1px solid', borderColor: location === l ? 'var(--accent)' : 'var(--line2)',
              }}
            >
              {l}
            </button>
          ))}
        </div>
        {fieldErrors.location && <div className="field-error" role="alert">{fieldErrors.location}</div>}
      </div>

      {/* Manager */}
      <div className="field" style={{ marginBottom: 18 }}>
        <label>I'm the family manager</label>
        <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
          <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 120px' }}>
              <input
                className="input"
                type="text"
                placeholder="First name"
                value={managerFirstName}
                onChange={e => setManagerFirstName(e.target.value)}
                disabled={submitting}
                aria-label="Your first name"
                aria-invalid={!!fieldErrors.managerFirstName}
              />
              {fieldErrors.managerFirstName && <div className="field-error" role="alert">{fieldErrors.managerFirstName}</div>}
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <input
                className="input"
                type="text"
                placeholder="Last name"
                value={managerLastName}
                onChange={e => setManagerLastName(e.target.value)}
                disabled={submitting}
                aria-label="Your last name"
                aria-invalid={!!fieldErrors.managerLastName}
              />
              {fieldErrors.managerLastName && <div className="field-error" role="alert">{fieldErrors.managerLastName}</div>}
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {(['Male', 'Female', 'PreferNotToSay'] as const).map(g => (
              <button
                key={g}
                className="pill"
                onClick={() => setManagerGender(g)}
                disabled={submitting}
                style={{
                  padding: '6px 10px', fontSize: 12,
                  background: managerGender === g ? 'var(--accent)' : 'var(--surface)',
                  color: managerGender === g ? '#fff' : 'var(--body-text)',
                  border: '1px solid', borderColor: managerGender === g ? 'var(--accent)' : 'var(--line2)',
                }}
              >
                {g === 'PreferNotToSay' ? 'Prefer not to say' : g}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <SetuAvatar name={managerDisplayName} size={40}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{managerDisplayName}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{email} · {phone}</div>
            </div>
            <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Manager</span>
          </div>
        </div>
      </div>

      {/* Additional members */}
      <div className="field" style={{ marginBottom: 6 }}>
        <label>Family members</label>
      </div>
      <div className="col" style={{ gap: 10, marginBottom: 18 }}>
        {additionalMembers.map(m => (
          <div key={m.id} style={{ position: 'relative' }}>
            <AddedMemberRow
              name={`${m.firstName} ${m.lastName}`}
              type={`${m.type} · ${m.gender === 'PreferNotToSay' ? 'not specified' : m.gender}${m.email ? ` · ${m.email}` : ''}${m.phone ? ` · ${m.phone}` : ''}`}
            />
            <button
              className="focus-ring"
              onClick={() => handleRemoveMember(m.id)}
              disabled={submitting}
              aria-label={`Remove ${m.firstName} ${m.lastName}`}
              style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 0, color: 'var(--err)', fontSize: 11, padding: 4 }}
            >
              Remove
            </button>
          </div>
        ))}

        {showAddMember ? (
          <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
            <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="text"
                placeholder="First name"
                value={draftFirstName}
                onChange={e => setDraftFirstName(e.target.value)}
                style={{ flex: '1 1 100px' }}
                aria-label="Member first name"
              />
              <input
                className="input"
                type="text"
                placeholder="Last name"
                value={draftLastName}
                onChange={e => setDraftLastName(e.target.value)}
                style={{ flex: '1 1 100px' }}
                aria-label="Member last name"
              />
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="email"
                placeholder="Email (optional)"
                value={draftEmail}
                onChange={e => setDraftEmail(e.target.value)}
                style={{ flex: '1 1 100px' }}
                aria-label="Member email"
              />
              <input
                className="input"
                type="tel"
                placeholder="Phone (optional)"
                value={draftPhone}
                onChange={e => setDraftPhone(e.target.value)}
                style={{ flex: '1 1 100px' }}
                aria-label="Member phone"
              />
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>
              Adding a member&apos;s own email or phone helps us recognize them later and avoid a duplicate family record.
            </div>
            {draftError && <div className="field-error" role="alert" style={{ marginBottom: 10 }}>{draftError}</div>}
            <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {(['Adult', 'Child'] as const).map(t => (
                <button
                  key={t}
                  className="pill"
                  onClick={() => setDraftType(t)}
                  style={{
                    padding: '6px 10px', fontSize: 12,
                    background: draftType === t ? 'var(--accent)' : 'var(--surface)',
                    color: draftType === t ? '#fff' : 'var(--body-text)',
                    border: '1px solid', borderColor: draftType === t ? 'var(--accent)' : 'var(--line2)',
                  }}
                >
                  {t}
                </button>
              ))}
              {(['Male', 'Female', 'PreferNotToSay'] as const).map(g => (
                <button
                  key={g}
                  className="pill"
                  onClick={() => setDraftGender(g)}
                  style={{
                    padding: '6px 10px', fontSize: 12,
                    background: draftGender === g ? 'var(--accent)' : 'var(--surface)',
                    color: draftGender === g ? '#fff' : 'var(--body-text)',
                    border: '1px solid', borderColor: draftGender === g ? 'var(--accent)' : 'var(--line2)',
                  }}
                >
                  {g === 'PreferNotToSay' ? 'Prefer not to say' : g}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn--p"
                onClick={handleAddMember}
                disabled={!draftFirstName.trim() || !draftLastName.trim()}
                style={{ flex: 1 }}
              >
                Add member
              </button>
              <button
                className="btn btn--g"
                onClick={() => { setShowAddMember(false); setDraftFirstName(''); setDraftLastName(''); setDraftEmail(''); setDraftPhone(''); setDraftError(''); }}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="focus-ring"
            onClick={() => setShowAddMember(true)}
            disabled={submitting}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px', background: 'transparent', border: '1px dashed var(--line2)', borderRadius: 'var(--radius)', color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}
          >
            <SetuIcon.plus/> Add another member
          </button>
        )}
      </div>

      <button
        className="btn btn--p btn--block"
        onClick={handleSubmit}
        disabled={submitting}
      >
        {submitting ? 'Creating family…' : 'Create family & continue →'}
      </button>
      <p style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
        You can edit anything after — this is just to get you started.
      </p>
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', overflowY: 'auto' }}>
            <Link href="/register" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, marginBottom: 12, color: 'var(--body-text)', display: 'inline-flex' }}>
              <SetuIcon.back/>
            </Link>
            {formContent}
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 'auto' }}>
              <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--body-text)', textDecoration: 'none', fontSize: 13, marginBottom: 40 }}>
                <SetuIcon.back/> Back
              </Link>
              <SetuLogo size={22}/>
            </div>
            <div style={{ maxWidth: 520, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
              {formContent}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
              <span>setu.chinmayatoronto.org</span>
              <span>·</span>
              <span>© 2026 CMT</span>
            </div>
          </div>
          <RightPane/>
        </CspRoot>
      </div>
    </>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function RegisterFamilyPage() {
  if (!flags.setuAuth) {
    return <RegisterFamilyPrototype />;
  }
  // useSearchParams() inside RegisterFamilyReal requires a Suspense boundary
  // for Next 16 static generation to bail cleanly.
  return (
    <Suspense fallback={null}>
      <RegisterFamilyReal />
    </Suspense>
  );
}
