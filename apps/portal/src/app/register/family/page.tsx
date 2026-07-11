'use client';

import { Suspense, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast, SetuLogo, SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { isMemberComplete, NO_ALLERGIES, CANADIAN_POSTAL_RE } from '@cmt/shared-domain';
import { CspRoot, StepHeader, AddedMemberRow } from '@/features/family/components/atoms';
import { VolunteeringSkillsPicker } from '@/features/setu/members/volunteering-skills-picker';
import { ProvinceSelect } from '@/features/setu/members/province-select';
import { flags } from '@/lib/flags';

// ─── Types ────────────────────────────────────────────────────────────────────

type Location = 'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham';
// Capture forms drop PreferNotToSay — the matrix treats it as missing, so a
// human must pick Male or Female. '' is the no-selection placeholder.
type Gender = 'Male' | 'Female';
type GenderChoice = Gender | '';
type MemberType = 'Adult' | 'Child';

interface AdditionalMember {
  id: string;
  firstName: string;
  lastName: string;
  type: MemberType;
  gender: Gender;
  foodAllergies: string;
  // Adult-only
  email?: string;
  phone?: string;
  volunteeringSkills?: string[];
  // Child-only
  schoolGrade?: string;
  birthMonthYear?: string; // canonical 'YYYY-MM'
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

// Compose a month index (1-12) + 4-digit year into the canonical 'YYYY-MM'
// birthMonthYear the server persists (and from which it derives birthMonth).
function toBirthMonthYear(monthNum: string, year: string): string {
  if (!monthNum || !year) return '';
  return `${year}-${monthNum.padStart(2, '0')}`;
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
  // Required family home address. Families are Ontario-based, so default province to ON.
  const [street, setStreet] = useState('');
  const [unit, setUnit] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('ON');
  const [postalCode, setPostalCode] = useState('');
  const [managerFirstName, setManagerFirstName] = useState('');
  const [managerLastName, setManagerLastName] = useState('');
  const [managerGender, setManagerGender] = useState<GenderChoice>('');
  // Manager is an Adult → needs foodAllergies + at least one volunteering skill.
  const [managerFoodAllergies, setManagerFoodAllergies] = useState('');
  const [managerSkills, setManagerSkills] = useState<string[]>([]);
  const [additionalMembers, setAdditionalMembers] = useState<AdditionalMember[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  // Email-verification gate: before the family is created the manager proves
  // they own the email via a 6-digit code. 'form' collects details; 'code'
  // collects the OTP, then verify-code → registrationGrant → register.
  const [phase, setPhase] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');

  // New-member draft state
  const [draftFirstName, setDraftFirstName] = useState('');
  const [draftLastName, setDraftLastName] = useState('');
  const [draftType, setDraftType] = useState<MemberType>('Adult');
  const [draftGender, setDraftGender] = useState<GenderChoice>('');
  const [draftFoodAllergies, setDraftFoodAllergies] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftSkills, setDraftSkills] = useState<string[]>([]);
  const [draftSchoolGrade, setDraftSchoolGrade] = useState('');
  const [draftBirthMonth, setDraftBirthMonth] = useState(''); // '1'..'12'
  const [draftBirthYear, setDraftBirthYear] = useState('');
  const [draftError, setDraftError] = useState('');

  const currentYear = new Date().getFullYear();
  const birthYears = Array.from({ length: 26 }, (_, i) => String(currentYear - i));

  function resetDraft() {
    setDraftFirstName('');
    setDraftLastName('');
    setDraftType('Adult');
    setDraftGender('');
    setDraftFoodAllergies('');
    setDraftEmail('');
    setDraftPhone('');
    setDraftSkills([]);
    setDraftSchoolGrade('');
    setDraftBirthMonth('');
    setDraftBirthYear('');
    setDraftError('');
  }

  // Build the draft member object the same shape the matrix + server expect,
  // so completeness can be judged with the SHARED helper (one rule set).
  const draftBirthMonthYear = toBirthMonthYear(draftBirthMonth, draftBirthYear);
  const draftMember: AdditionalMember = {
    id: 'draft',
    firstName: draftFirstName.trim(),
    lastName: draftLastName.trim(),
    type: draftType,
    gender: (draftGender || 'Male') as Gender, // placeholder; completeness checks the real value below
    foodAllergies: draftFoodAllergies.trim(),
    ...(draftType === 'Adult'
      ? {
          ...(draftEmail.trim() ? { email: draftEmail.trim() } : {}),
          ...(draftPhone.trim() ? { phone: draftPhone.trim() } : {}),
          volunteeringSkills: draftSkills,
        }
      : {
          ...(draftSchoolGrade.trim() ? { schoolGrade: draftSchoolGrade.trim() } : {}),
          ...(draftBirthMonthYear ? { birthMonthYear: draftBirthMonthYear } : {}),
        }),
  };
  // Completeness uses the actual selected gender ('' ⇒ matrix sees it missing).
  const draftComplete = isMemberComplete({ ...draftMember, gender: draftGender || undefined });

  const handleAddMember = useCallback(() => {
    const email = draftEmail.trim();
    // A member's email, if present, must look valid before the server sees it.
    if (draftType === 'Adult' && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setDraftError('Enter a valid email address.');
      return;
    }
    if (!draftComplete || !draftGender) {
      setDraftError('Please fill in all required fields for this member.');
      return;
    }
    setDraftError('');
    setAdditionalMembers(prev => [
      ...prev,
      { ...draftMember, id: `${Date.now()}`, gender: draftGender },
    ]);
    resetDraft();
    setShowAddMember(false);
  }, [draftComplete, draftGender, draftEmail, draftType, draftMember]);

  const handleRemoveMember = useCallback((id: string) => {
    setAdditionalMembers(prev => prev.filter(m => m.id !== id));
  }, []);

  // Step 1: validate the form, then email the manager a verification code and
  // advance to the code step. The family is NOT created yet.
  async function handleSubmit() {
    setFieldErrors({});
    const errors: Record<string, string> = {};
    if (!familyName.trim()) errors.familyName = 'Family name is required.';
    if (!location) errors.location = 'Please select a primary location.';
    // Required home address - block advancing to the OTP phase until it's valid.
    if (!street.trim()) errors.street = 'Street address is required.';
    if (!city.trim()) errors.city = 'City is required.';
    if (!province.trim()) errors.province = 'Please select a province.';
    if (!CANADIAN_POSTAL_RE.test(postalCode.trim())) errors.postalCode = 'Enter a valid postal code (e.g. A1A 1A1).';
    if (!managerFirstName.trim()) errors.managerFirstName = 'Your first name is required.';
    if (!managerLastName.trim()) errors.managerLastName = 'Your last name is required.';
    // Manager is an Adult — block until the matrix is satisfied (gender pick,
    // foodAllergies, at least one volunteering skill; email/phone arrive from
    // the verified query params). Mirrors the shared helper the server uses.
    if (!managerGender) errors.managerGender = 'Please select a gender.';
    if (!managerFoodAllergies.trim()) errors.managerFoodAllergies = 'Please tell us about allergies, or pick "No known allergies".';
    if (managerSkills.length < 1) errors.managerSkills = 'Please pick at least one way you can help.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/setu/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // purpose:'register' so a brand-new email actually receives the code
        // (sign-in's anti-enumeration silent-200 would otherwise send nothing).
        body: JSON.stringify({ type: 'email', value: email, purpose: 'register' }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({})) as { resetAt?: string };
        toast.error(
          body.resetAt
            ? `Too many code requests. Try again after ${new Date(body.resetAt).toLocaleTimeString()}.`
            : 'Too many code requests. Please wait a few minutes.',
        );
        return;
      }
      if (!res.ok) {
        toast.error('Could not send your verification code. Please try again.');
        return;
      }
      setCode('');
      setCodeError('');
      setPhase('code');
    } catch {
      toast.error('Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Step 2: verify the emailed code, obtain a one-time registration grant, then
  // create the family. The grant proves the manager owns the email.
  async function handleVerifyAndCreate() {
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError('Enter the 6-digit code from your email.');
      return;
    }
    setCodeError('');
    setSubmitting(true);
    try {
      const verifyRes = await fetch('/api/setu/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email', value: email, code: code.trim() }),
      });
      if (verifyRes.status === 400) {
        setCodeError('That code is invalid or expired. Check your email or resend.');
        return;
      }
      if (!verifyRes.ok) {
        toast.error('Could not verify the code. Please try again.');
        return;
      }
      const verified = await verifyRes.json() as { registrationGrant?: string; redirectTo?: string };
      // Race: the email already belongs to a family / staff account → verify-code
      // signed them in (no grant). Just follow the redirect.
      if (!verified.registrationGrant) {
        window.location.href = verified.redirectTo ?? '/family';
        return;
      }

      const res = await fetch('/api/setu/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          phone,
          familyName: familyName.trim(),
          location,
          familyAddress: {
            street: street.trim(),
            unit: unit.trim(),
            city: city.trim(),
            province: province.trim(),
            postalCode: postalCode.trim().toUpperCase(),
          },
          manager: {
            firstName: managerFirstName.trim(),
            lastName: managerLastName.trim(),
            gender: managerGender,
            foodAllergies: managerFoodAllergies.trim(),
            volunteeringSkills: managerSkills,
          },
          additionalMembers: additionalMembers.map((m) => ({
            firstName: m.firstName,
            lastName: m.lastName,
            type: m.type,
            gender: m.gender,
            foodAllergies: m.foodAllergies,
            ...(m.email ? { email: m.email } : {}),
            ...(m.phone ? { phone: m.phone } : {}),
            ...(m.volunteeringSkills ? { volunteeringSkills: m.volunteeringSkills } : {}),
            ...(m.schoolGrade ? { schoolGrade: m.schoolGrade } : {}),
            ...(m.birthMonthYear ? { birthMonthYear: m.birthMonthYear } : {}),
          })),
          registrationGrant: verified.registrationGrant,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; fields?: Record<string, string> };
        if (body.fields) {
          setFieldErrors(body.fields);
          setPhase('form');
        } else {
          const messages: Record<string, string> = {
            'duplicate-contact-in-form':
              'The same email or phone is entered for more than one family member. Give each member a distinct email or phone, or leave it blank.',
            'duplicate-contact':
              "One of those contacts is already registered. If it's you, sign in instead.",
            'registration-unverified':
              'Your verification expired. Please resend the code and try again.',
            // Per-type required-matrix 400s (the client already blocks these, so
            // they only surface on a stale/edited request — bounce back to fix).
            'foodAllergies-required': 'Please tell us about allergies for every member (or pick "No known allergies").',
            'contact-required': 'Every adult needs an email and a phone number.',
            'skills-required': 'Every adult needs at least one volunteering skill.',
            'grade-required': 'Every child needs a school grade.',
            'birthmonth-required': 'Every child needs a birth month and year.',
          };
          const requiresFix = body.error ? Object.prototype.hasOwnProperty.call(messages, body.error) : false;
          toast.error(
            (body.error && messages[body.error]) ?? body.error ?? 'Registration failed. Please try again.',
          );
          if (body.error === 'registration-unverified') setCode('');
          // Send the user back to the details step to correct a matrix error.
          if (requiresFix && body.error !== 'registration-unverified' && !body.error?.startsWith('duplicate')) {
            setPhase('form');
          }
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

      {/* Home address */}
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Home address <span className="req">·</span></label>
        <div className="col" style={{ gap: 8 }}>
          <div>
            <input
              className="input"
              type="text"
              placeholder="Street address"
              value={street}
              onChange={e => setStreet(e.target.value)}
              disabled={submitting}
              aria-label="Street address"
              aria-invalid={!!fieldErrors.street}
            />
            {fieldErrors.street && <div className="field-error" role="alert">{fieldErrors.street}</div>}
          </div>
          <input
            className="input"
            type="text"
            placeholder="Unit / apt (optional)"
            value={unit}
            onChange={e => setUnit(e.target.value)}
            disabled={submitting}
            aria-label="Unit (optional)"
          />
          <div>
            <input
              className="input"
              type="text"
              placeholder="City"
              value={city}
              onChange={e => setCity(e.target.value)}
              disabled={submitting}
              aria-label="City"
              aria-invalid={!!fieldErrors.city}
            />
            {fieldErrors.city && <div className="field-error" role="alert">{fieldErrors.city}</div>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: '1 1 140px' }}>
              <ProvinceSelect value={province} onChange={setProvince} />
              {fieldErrors.province && <div className="field-error" role="alert">{fieldErrors.province}</div>}
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <input
                className="input"
                type="text"
                placeholder="Postal code"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                disabled={submitting}
                aria-label="Postal code"
                aria-invalid={!!fieldErrors.postalCode}
              />
              {fieldErrors.postalCode && <div className="field-error" role="alert">{fieldErrors.postalCode}</div>}
            </div>
          </div>
        </div>
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
          <div style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {(['Male', 'Female'] as const).map(g => (
                <button
                  key={g}
                  type="button"
                  className="pill"
                  onClick={() => setManagerGender(g)}
                  disabled={submitting}
                  aria-pressed={managerGender === g}
                  style={{
                    padding: '6px 10px', fontSize: 12,
                    background: managerGender === g ? 'var(--accent)' : 'var(--surface)',
                    color: managerGender === g ? '#fff' : 'var(--body-text)',
                    border: '1px solid', borderColor: managerGender === g ? 'var(--accent)' : 'var(--line2)',
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
            {fieldErrors.managerGender && <div className="field-error" role="alert">{fieldErrors.managerGender}</div>}
          </div>

          {/* Food allergies (required for all) */}
          <div className="field" style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12 }}>Food allergies <span className="req">·</span></label>
            <input
              className="input"
              type="text"
              placeholder="e.g. Peanuts"
              value={managerFoodAllergies === NO_ALLERGIES ? '' : managerFoodAllergies}
              onChange={e => setManagerFoodAllergies(e.target.value)}
              disabled={submitting || managerFoodAllergies === NO_ALLERGIES}
              aria-label="Your food allergies"
              aria-invalid={!!fieldErrors.managerFoodAllergies}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 6, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={managerFoodAllergies === NO_ALLERGIES}
                onChange={e => setManagerFoodAllergies(e.target.checked ? NO_ALLERGIES : '')}
                disabled={submitting}
              />
              No known allergies
            </label>
            {fieldErrors.managerFoodAllergies && <div className="field-error" role="alert">{fieldErrors.managerFoodAllergies}</div>}
          </div>

          {/* Volunteering skills (adult = manager, required ≥1) */}
          <div className="field" style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12 }}>How can you help? <span className="req">·</span></label>
            <VolunteeringSkillsPicker value={managerSkills} onChange={setManagerSkills} />
            {fieldErrors.managerSkills && <div className="field-error" role="alert">{fieldErrors.managerSkills}</div>}
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
              type={`${m.type} · ${m.gender}${m.schoolGrade ? ` · ${m.schoolGrade}` : ''}${m.email ? ` · ${m.email}` : ''}${m.phone ? ` · ${m.phone}` : ''}`}
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
            {/* Names */}
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

            {/* Type */}
            <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {(['Adult', 'Child'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  className="pill"
                  onClick={() => setDraftType(t)}
                  aria-pressed={draftType === t}
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
            </div>

            {/* Gender (required for all) */}
            <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {(['Male', 'Female'] as const).map(g => (
                <button
                  key={g}
                  type="button"
                  className="pill"
                  onClick={() => setDraftGender(g)}
                  aria-pressed={draftGender === g}
                  style={{
                    padding: '6px 10px', fontSize: 12,
                    background: draftGender === g ? 'var(--accent)' : 'var(--surface)',
                    color: draftGender === g ? '#fff' : 'var(--body-text)',
                    border: '1px solid', borderColor: draftGender === g ? 'var(--accent)' : 'var(--line2)',
                  }}
                >
                  {g}
                </button>
              ))}
            </div>

            {/* Food allergies (required for all) */}
            <div className="field" style={{ marginBottom: 10 }}>
              <input
                className="input"
                type="text"
                placeholder="Food allergies"
                value={draftFoodAllergies === NO_ALLERGIES ? '' : draftFoodAllergies}
                onChange={e => setDraftFoodAllergies(e.target.value)}
                disabled={draftFoodAllergies === NO_ALLERGIES}
                aria-label="Member food allergies"
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 6, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={draftFoodAllergies === NO_ALLERGIES}
                  onChange={e => setDraftFoodAllergies(e.target.checked ? NO_ALLERGIES : '')}
                />
                No known allergies
              </label>
            </div>

            {/* Adult-only: contact + skills */}
            {draftType === 'Adult' && (
              <>
                <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    type="email"
                    placeholder="Email"
                    value={draftEmail}
                    onChange={e => setDraftEmail(e.target.value)}
                    style={{ flex: '1 1 100px' }}
                    aria-label="Member email"
                  />
                  <input
                    className="input"
                    type="tel"
                    placeholder="Phone"
                    value={draftPhone}
                    onChange={e => setDraftPhone(e.target.value)}
                    style={{ flex: '1 1 100px' }}
                    aria-label="Member phone"
                  />
                </div>
                <div className="hint" style={{ marginBottom: 10 }}>
                  An adult&apos;s email and phone are required. It&apos;s fine to reuse the manager&apos;s.
                </div>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 12 }}>How can they help? <span className="req">·</span></label>
                  <VolunteeringSkillsPicker value={draftSkills} onChange={setDraftSkills} />
                </div>
              </>
            )}

            {/* Child-only: grade + birth month/year */}
            {draftType === 'Child' && (
              <>
                <div className="field" style={{ marginBottom: 10 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder="School grade (e.g. Grade 3)"
                    value={draftSchoolGrade}
                    onChange={e => setDraftSchoolGrade(e.target.value)}
                    aria-label="Member school grade"
                  />
                </div>
                <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                  <select
                    className="input"
                    aria-label="Birth month"
                    value={draftBirthMonth}
                    onChange={e => setDraftBirthMonth(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Birth month</option>
                    {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                  </select>
                  <select
                    className="input"
                    aria-label="Birth year"
                    value={draftBirthYear}
                    onChange={e => setDraftBirthYear(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Birth year</option>
                    {birthYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </>
            )}

            {draftError && <div className="field-error" role="alert" style={{ marginBottom: 10 }}>{draftError}</div>}

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn--p"
                onClick={handleAddMember}
                disabled={!draftComplete}
                style={{ flex: 1 }}
              >
                Add member
              </button>
              <button
                type="button"
                className="btn btn--g"
                onClick={() => { resetDraft(); setShowAddMember(false); }}
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
        {submitting ? 'Sending code…' : 'Verify email & create family →'}
      </button>
      <p style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
        We&apos;ll email a quick code to <strong>{email}</strong> to confirm it&apos;s yours, then create your family.
      </p>
    </>
  );

  const codeStepContent = (
    <>
      <StepHeader step={2} of={2} label="Verify your email"/>
      <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 18, marginBottom: 8 }}>Enter your code.</h1>
      <p style={{ fontSize: 14, color: 'var(--body-text)', marginBottom: 22, lineHeight: 1.5 }}>
        We emailed a 6-digit code to <strong>{email}</strong>. Enter it to confirm the email is yours and create your family.
      </p>

      <div className="field" style={{ marginBottom: 6 }}>
        <label>6-digit code <span className="req">·</span></label>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setCodeError(''); }}
          aria-label="6-digit verification code"
          aria-invalid={Boolean(codeError)}
          autoFocus
          style={{ letterSpacing: '0.3em', fontSize: 18 }}
        />
        {codeError && <div className="hint" style={{ color: 'var(--err)' }}>{codeError}</div>}
      </div>

      <button
        className="btn btn--p btn--block"
        onClick={handleVerifyAndCreate}
        disabled={submitting}
        style={{ marginTop: 14 }}
      >
        {submitting ? 'Creating family…' : 'Verify & create my family →'}
      </button>

      <div className="row" style={{ gap: 16, marginTop: 14, justifyContent: 'center' }}>
        <button
          type="button"
          className="focus-ring"
          style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, padding: 0, cursor: 'pointer' }}
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          Resend code
        </button>
        <button
          type="button"
          className="focus-ring"
          style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, cursor: 'pointer' }}
          onClick={() => { setPhase('form'); setCode(''); setCodeError(''); }}
          disabled={submitting}
        >
          ← Back to details
        </button>
      </div>
    </>
  );

  const content = phase === 'code' ? codeStepContent : formContent;

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', overflowY: 'auto' }}>
            <Link href="/register" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, marginBottom: 12, color: 'var(--body-text)', display: 'inline-flex' }}>
              <SetuIcon.back/>
            </Link>
            {content}
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
              {content}
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
