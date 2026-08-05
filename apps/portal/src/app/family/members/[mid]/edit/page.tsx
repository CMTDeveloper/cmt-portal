'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon, toast } from '@cmt/ui';
import { CHILD_GRADE_OPTIONS, NO_ALLERGIES, whatsMissingForMember, type MemberRequiredField } from '@cmt/shared-domain';
import { CspRoot, FieldError } from '@/features/family/components/atoms';
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
  // Vaibhav, 2026-08-02: "option for family to disable member who are no longer
  // active, Not to delete as we loose history." This is that option, and it sits
  // beside "Remove from family" deliberately - the destructive action was the
  // only thing here, so a family with a member who had simply finished had to
  // erase them. It is also the ONLY way back: /complete-profile can retire
  // someone, but its Undo is a draft, gone the moment they save.
  const [participation, setParticipation] = useState<'active' | 'inactive'>('active');
  // What this member WAS when the screen loaded. The graduation control below is
  // offered on the strength of this, not of `type`, so that ticking it does not
  // make the control that produced it disappear mid-edit.
  const [loadedType, setLoadedType] = useState<MemberType | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);

  // isEditingOther: manager editing a different member's profile
  const isEditingOther = data ? (data.isManager && mid !== data.currentMid) : false;
  // showManagerToggle: only when a manager edits someone other than themselves,
  // and only on an ADULT record.
  //
  // Vaibhav, 2026-08-04: *"Child record should not have an option 'Family
  // manager'"*. The server has always refused it (`manager-must-be-adult`,
  // write-member.ts), so offering the checkbox on a child was offering a click
  // that could only ever come back as a 409 - the control was never a
  // permission, just a way to fail.
  //
  // Keyed on the LIVE `type`, not the loaded one, so switching a member to
  // Child hides it immediately rather than letting a stale tick ride along
  // into a save the API would reject.
  const showManagerToggle = isEditingOther && type === 'Adult';
  // Same scope as "Remove from family", and for the same reason /complete-profile
  // uses it: retiring YOURSELF while signed in and using the portal is a way to
  // excuse your own required fields, not an answer about attendance.
  const canSetParticipation = isEditingOther;

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
  // The required-field matrix does not apply to someone who no longer takes
  // part - the completion gate excuses them, and `updateMember` now does too.
  // Without this line the form would block a save the server would accept, on
  // fields the portal has just promised to stop asking for.
  const canSubmit = participation === 'inactive' || missing.length === 0;

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
        setLoadedType(member.type);
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
        // Absent ⇒ active. Every migrated member doc predates the field.
        setParticipation(member.participation === 'inactive' ? 'inactive' : 'active');
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
    };

    // Only a manager editing SOMEONE ELSE sees the control, so only they can
    // send it. Sending it unconditionally would let a member editing their own
    // record silently re-assert 'active' on every save.
    if (canSetParticipation) {
      body.participation = participation;
    }

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
        // Hard nav - see the note on the delete path below. This one cannot
        // strand the button (the `finally` resets `saving`), but a soft push
        // into the gated /family layout can still bounce on a stale cached read
        // and show the member's OLD values right after saving them.
        window.location.assign(`/family/members/${mid}`);
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

  // ── Graduated / no longer in school ────────────────────────────────────────
  //
  // Vaibhav, 2026-08-04: *"for graduates or children who are no longer in
  // school, can we have a check box instead 'Graduated / Not In School' - so
  // when that is checked then, the child is converted to adult"*.
  //
  // It is deliberately NOT a repurposing of "No longer participating", which he
  // suggested: the two say opposite things about the same person. A graduate is
  // still IN the family and may well join the Adult Study Class; someone who no
  // longer participates has stepped away. Merging them would have made the one
  // clear case - a child who finished school - the way to also disappear them
  // from everything.
  //
  // Mechanically this is the "Member type: Adult" toggle above, which already
  // did the conversion. Nobody found it, because "is this person an adult?" is
  // not the question a parent is asking - "has my child finished school?" is.
  const showGraduation = !loading && isEditingOther && loadedType === 'Child';
  const graduating = type === 'Adult' && loadedType === 'Child';
  const graduationSection = showGraduation ? (
    <div className="field" style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }} data-testid="graduation-section">
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          data-testid="graduation-toggle"
          checked={graduating}
          onChange={(e) => setType(e.target.checked ? 'Adult' : 'Child')}
          style={{ width: 18, height: 18 }}
        />
        Graduated / not in school
      </label>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
        {graduating
          // Said plainly BEFORE they save, because the adult fields appear the
          // instant this is ticked and an unexplained wall of new required
          // fields reads as the form breaking.
          ? 'They will be saved as an adult and leave the children’s class lists. We will ask for their own email and phone, as we do for every adult.'
          : 'Tick this when your child has finished school. They stay in your family as an adult and can join adult programs.'}
      </p>
    </div>
  ) : null;

  // The answer a family usually wants for someone who has stepped away, and -
  // since 2026-08-04 - the ONLY thing on this screen for them, the destructive
  // "Remove from family" having been withdrawn.
  const participationSection = !loading && canSetParticipation ? (
    <div className="field" style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }} data-testid="participation-section">
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          data-testid="participation-toggle"
          checked={participation === 'inactive'}
          onChange={(e) => setParticipation(e.target.checked ? 'inactive' : 'active')}
          style={{ width: 18, height: 18 }}
        />
        {/* Vaibhav, 2026-08-04: *"'No longer participating' is not clear to
            everyone. What exactly does it do?"* - so the label now says what it
            DOES rather than naming a state, and the help text leads with what
            is kept, since the fear behind the question is losing the record. */}
        Not taking part — hide from class lists
      </label>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
        Nothing is deleted: their record and past attendance are kept. They stop
        appearing on class rosters and at check-in, and we stop asking you to
        complete their profile. Untick to bring them back at any time.
      </p>
    </div>
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
        <>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>School grade <span className="req">·</span></label>
            <select className="input" aria-label="School grade" value={schoolGrade} onChange={(e) => setSchoolGrade(e.target.value)}>
              <option value="" disabled>Select grade…</option>
              {CHILD_GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
            <FieldError message={fieldErrors.schoolGrade}/>
            {reqError('schoolGrade', 'School grade is required')}
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
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
        </>
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

      {/* Graduation first: it is the happier and far more common event, and a
          family who ticks it should never have had to read past "not taking
          part" to find it. */}
      {graduationSection}
      {participationSection}
    </>
  );

  // ── "Remove from family" is gone from the family's own screen ──────────────
  //
  // Vaibhav, 2026-08-04: *"please remove the button as we do not want families
  // to remove any members. At the very least, they can only disable."* Same
  // reasoning he gave on 2026-08-02 for adding the disable control in the first
  // place: *"Not to delete as we loose history."*
  //
  // Deleting a member is not a small edit - it drops their attendance, their
  // contact key, and their place in a family's record, permanently and with no
  // undo. The reversible control is right above, and it is what a family
  // actually wants in every case they reached for this one.
  //
  // Staff keep the capability: `DELETE /api/welcome/families/[fid]/members/[mid]`
  // is unchanged, and the office can reach it from `/welcome/family/[fid]` (see
  // the RemoveMemberControl added in the same change) - so a duplicate created
  // by mistake is still fixable, just not by the family, and never without an
  // audit row naming who did it.

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
