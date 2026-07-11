'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast, SetuLogo } from '@cmt/ui';
import {
  whatsMissingForMember,
  isMemberComplete,
  isFamilyAddressComplete,
  CANADIAN_POSTAL_RE,
  CHILD_GRADE_OPTIONS,
  NO_ALLERGIES,
  type MemberRequiredField,
} from '@cmt/shared-domain';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import { CspRoot, FieldError, SectionLabel } from '@/features/family/components/atoms';
import { ProvinceSelect } from '@/features/setu/members/province-select';
import { VolunteeringSkillsPicker } from '@/features/setu/members/volunteering-skills-picker';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import { patchMemberClient } from '@/features/setu/members/patch-member-client';
import { navigateTo } from '@/features/setu/members/navigate-to';
import { memberWriteErrorMessage } from '@/features/setu/members/member-write-error';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';
import { LoadingOm } from '@/components/chrome/loading-om';

type Gender = 'Male' | 'Female';

// Month dropdown carries the numeric value (1-12) so we persist both the
// canonical birthMonthYear ('YYYY-MM') and the derived birthMonth (1-12) —
// identical to the add/edit member forms.
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

// Loose email/phone validators so the form's notion of "complete" agrees with
// the write route (z.string().email() / z.string().min(7)). Without these, a
// short/garbled value satisfies the shared nonEmptyString completeness check, the
// Save button thinks the member is done, and the PATCH 400s on the server —
// stranding the user on the completion screen with no redirect.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}
function isValidPhone(s: string): boolean {
  return s.replace(/\D/g, '').length >= 7;
}

// Per-member draft of just the fields the completion screen can edit. We seed
// each from the member's current value so a partially-complete member only has
// to fill the gaps.
interface MemberDraft {
  gender: '' | Gender;
  foodAllergies: string;
  noAllergies: boolean;
  email: string;
  phone: string;
  volunteeringSkills: string[];
  schoolGrade: string;
  birthMonth: string; // '1'..'12'
  birthYear: string;
}

function seedDraft(m: MemberDoc): MemberDraft {
  // Parse an existing 'YYYY-MM' into the two dropdowns.
  let birthMonth = '';
  let birthYear = '';
  if (m.birthMonthYear && /^\d{4}-\d{2}$/.test(m.birthMonthYear)) {
    const [y, mo] = m.birthMonthYear.split('-');
    birthYear = y ?? '';
    birthMonth = mo ? String(Number(mo)) : '';
  }
  const existingAllergies = (m.foodAllergies ?? '').trim();
  return {
    gender: m.gender === 'Male' || m.gender === 'Female' ? m.gender : '',
    foodAllergies: existingAllergies === NO_ALLERGIES ? '' : existingAllergies,
    noAllergies: existingAllergies === NO_ALLERGIES,
    email: m.email ?? '',
    phone: m.phone ?? '',
    volunteeringSkills: m.volunteeringSkills ?? [],
    schoolGrade: m.schoolGrade ?? '',
    birthMonth,
    birthYear,
  };
}

// The effective member shape implied by a draft, used to re-check completeness
// with the SAME shared helper the gate + write routes use.
function draftToMemberShape(m: MemberDoc, d: MemberDraft) {
  const monthNum = d.birthMonth ? Number(d.birthMonth) : null;
  const birthMonthYear = monthNum && d.birthYear ? `${d.birthYear}-${String(monthNum).padStart(2, '0')}` : '';
  const foodAllergies = d.noAllergies ? NO_ALLERGIES : d.foodAllergies.trim();
  return {
    type: m.type,
    gender: d.gender || null,
    firstName: m.firstName,
    lastName: m.lastName,
    foodAllergies: foodAllergies || null,
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
    volunteeringSkills: d.volunteeringSkills,
    schoolGrade: d.schoolGrade.trim() || null,
    birthMonthYear: birthMonthYear || null,
  };
}

const FIELD_LABEL: Record<MemberRequiredField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  gender: 'Gender',
  type: 'Member type',
  foodAllergies: 'Food allergies',
  email: 'Email',
  phone: 'Phone',
  volunteeringSkills: 'Volunteering skills',
  schoolGrade: 'School grade',
  birthMonthYear: 'Birth month & year',
};

// Fields that have NO input on this screen (they're set at registration / by a
// sevak). If one is missing the card explains it rather than rendering a dead end.
const UNFILLABLE_FIELDS: readonly MemberRequiredField[] = ['firstName', 'lastName', 'type'];

/**
 * A single member's outstanding problems for the SUBMIT gate: the required
 * fields still missing, plus a per-field message map (required-but-empty OR
 * present-but-malformed for email/phone). Empty `messages` + empty `missing`
 * ⇒ this member is ready to save.
 */
function validateMember(m: MemberDoc, d: MemberDraft): {
  missing: MemberRequiredField[];
  messages: Partial<Record<MemberRequiredField, string>>;
} {
  const shape = draftToMemberShape(m, d);
  const missing = whatsMissingForMember(shape);
  const messages: Partial<Record<MemberRequiredField, string>> = {};
  for (const f of missing) {
    if (UNFILLABLE_FIELDS.includes(f)) continue; // explained separately, no input
    messages[f] = `${FIELD_LABEL[f]} is required.`;
  }
  // Format checks on fields that ARE filled (so they don't double up as "required").
  if (d.email.trim() && !isValidEmail(d.email)) messages.email = 'Enter a valid email address.';
  if (d.phone.trim() && !isValidPhone(d.phone)) messages.phone = 'Enter a valid phone number.';
  return { missing, messages };
}

/** Whether a member can be saved: nothing required is missing AND nothing malformed. */
function memberReady(m: MemberDoc, d: MemberDraft): boolean {
  const { missing, messages } = validateMember(m, d);
  return missing.length === 0 && Object.keys(messages).length === 0;
}

/**
 * Self-contained profile-completion form. Loads the current family, and for the
 * members the signed-in person is responsible for (a manager → every incomplete
 * member; a plain member → only their own record), renders the fields that were
 * missing AT LOAD. On Save, PATCHes each member; when nothing is missing anymore
 * it returns to /family.
 *
 * Which fields render is FROZEN to the server's missing set captured at load — it
 * never shrinks as the user types. Gating field visibility on the live, draft-
 * derived missing set (the prior behaviour) unmounted each input the instant its
 * value satisfied the shared `nonEmptyString` check — i.e. after the FIRST
 * character of an email/phone/grade — so a field literally vanished mid-typing and
 * left a 1-char fragment behind (issue #18). Freezing the set keeps every input
 * mounted until the member is saved.
 *
 * Completeness is judged by the shared @cmt/shared-domain helpers so this screen
 * agrees exactly with the gate that sent the user here and with the write route.
 */
export function CompleteProfileForm() {
  const [data, setData] = useState<FamilyWithMembers | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({});
  const [saving, setSaving] = useState(false);
  // Manager-only family home-address draft. Seeded from the family's saved
  // address when the data loads (below), defaulting province to Ontario.
  const [street, setStreet] = useState('');
  const [unit, setUnit] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('ON');
  const [postalCode, setPostalCode] = useState('');
  // Inline validation only surfaces AFTER a blocked Save attempt, then clears
  // live as each field becomes valid (so the user sees progress, not nagging).
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurrentFamilyClient()
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setLoading(false);
          return;
        }
        // If everything in scope is ALREADY complete (a stale tab, a direct
        // visit, or a prior save whose navigation was interrupted), don't sit on
        // a "save to continue" screen — hard-navigate straight to the dashboard.
        // The /family gate re-checks server-side. Keep loading=true so the form
        // never flashes before we leave.
        const scoped = result.isManager
          ? result.members
          : result.members.filter((m) => m.mid === result.currentMid);
        // A manager must ALSO have the required family home address before we can
        // short-circuit to /family — otherwise the gate would bounce them right
        // back here (a redirect loop) even though every member is complete.
        const addressDone = !result.isManager || isFamilyAddressComplete(result.family);
        if (scoped.every((m) => isMemberComplete(m)) && addressDone) {
          navigateTo('/family');
          return;
        }
        setData(result);
        const seeded: Record<string, MemberDraft> = {};
        for (const m of result.members) seeded[m.mid] = seedDraft(m);
        setDrafts(seeded);
        // Seed the manager's home-address draft from the saved value (province
        // defaults to Ontario when unset, matching the family-address card).
        const addr = result.family.familyAddress;
        setStreet(addr?.street ?? '');
        setUnit(addr?.unit ?? '');
        setCity(addr?.city ?? '');
        setProvince(addr?.province ?? 'ON');
        setPostalCode(addr?.postalCode ?? '');
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The members this person must complete. Scope: manager → all incomplete
  // members; plain member → own record only. Computed from `data` ALONE (NOT the
  // drafts) so the card list — and the set of fields each card renders — is
  // frozen to the server's missing set and never shrinks while the user types.
  const cards = useMemo(() => {
    if (!data) return [] as { member: MemberDoc; missing: MemberRequiredField[] }[];
    const scoped = data.isManager
      ? data.members
      : data.members.filter((m) => m.mid === data.currentMid);
    return scoped
      .map((member) => ({ member, missing: whatsMissingForMember(member) }))
      .filter((t) => t.missing.length > 0);
  }, [data]);

  // The members in scope (for the submit gate + PATCH loop).
  const scopedMembers = useMemo(() => {
    if (!data) return [] as MemberDoc[];
    return data.isManager ? data.members : data.members.filter((m) => m.mid === data.currentMid);
  }, [data]);

  // Whether the manager's family home address is filled and valid. Non-managers
  // never edit family-level data, so it's vacuously ready for them.
  const addressReady = useMemo(() => {
    if (!data?.isManager) return true;
    return (
      street.trim().length > 0 &&
      city.trim().length > 0 &&
      province.trim().length > 0 &&
      CANADIAN_POSTAL_RE.test(postalCode.trim())
    );
  }, [data, street, city, province, postalCode]);

  // Whether everything in scope is now saveable (drives the "all set" note). The
  // Save button itself is ALWAYS enabled (except while saving) so a click on an
  // incomplete form gives feedback instead of doing nothing. For a manager the
  // required family home address must also be filled and valid.
  const allReady = useMemo(() => {
    if (!data) return false;
    const membersOk = scopedMembers.every((member) => {
      const draft = drafts[member.mid];
      return draft ? memberReady(member, draft) : isMemberComplete(member);
    });
    return membersOk && addressReady;
  }, [data, scopedMembers, drafts, addressReady]);

  function update(mid: string, patch: Partial<MemberDraft>) {
    setDrafts((prev) => {
      const cur = prev[mid];
      if (!cur) return prev;
      return { ...prev, [mid]: { ...cur, ...patch } };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || saving) return;

    // Validate every scoped member first. If anything is missing or malformed,
    // surface inline errors (issue #18 #4 — a disabled button gave NO feedback)
    // and stop before any write.
    if (!allReady) {
      setShowErrors(true);
      const blockedByUnfillable = scopedMembers.some((m) => {
        const d = drafts[m.mid];
        return d ? validateMember(m, d).missing.some((f) => UNFILLABLE_FIELDS.includes(f)) : false;
      });
      toast.error(
        blockedByUnfillable
          ? 'Some details can only be set by a sevak — see the highlighted note.'
          : 'Please fill the highlighted fields to continue.',
      );
      return;
    }

    setSaving(true);

    // PATCH every member still in scope whose SERVER record is incomplete. We
    // send the member's current type so the write route's effectiveType picks the
    // right required matrix; we only send the completion-screen fields. (Checking
    // the DRAFT here would be a bug: the user has JUST completed the draft, so it
    // always looks complete and the PATCH would be skipped, persisting nothing.)
    let anyFailed = false;
    try {
      for (const member of scopedMembers) {
        const draft = drafts[member.mid];
        if (!draft) continue;
        if (isMemberComplete(member)) continue;

        const monthNum = draft.birthMonth ? Number(draft.birthMonth) : null;
        const birthMonthYear =
          monthNum && draft.birthYear ? `${draft.birthYear}-${String(monthNum).padStart(2, '0')}` : null;
        const foodAllergies = draft.noAllergies ? NO_ALLERGIES : draft.foodAllergies.trim() || null;

        const body: Record<string, unknown> = {
          type: member.type,
          gender: draft.gender || undefined,
          foodAllergies,
          email: draft.email.trim() || null,
          phone: draft.phone.trim() || null,
          volunteeringSkills: draft.volunteeringSkills,
          schoolGrade: draft.schoolGrade.trim() || null,
          birthMonthYear,
          ...(birthMonthYear ? { birthMonth: monthNum } : {}),
        };

        const result = await patchMemberClient(member.mid, body);
        if (!result.ok) {
          anyFailed = true;
          toast.error(memberWriteErrorMessage({ error: result.error }));
        }
      }

      // Manager-only: persist the required family home address. Runs after the
      // member loop and before navigation so a failed address save keeps the
      // user on this screen (same anyFailed gate the member loop uses).
      if (data.isManager && !anyFailed) {
        const res = await fetch('/api/setu/family', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            familyAddress: {
              street: street.trim(),
              unit: unit.trim(),
              city: city.trim(),
              province: province.trim(),
              postalCode: postalCode.trim().toUpperCase(),
            },
          }),
        });
        if (!res.ok) {
          anyFailed = true;
          toast.error('Could not save your home address. Please try again.');
        }
      }
    } catch {
      // A network failure (fetch reject) must never strand the button on
      // "Saving…" forever — re-enable it so the user can retry.
      toast.error('Something went wrong saving your profile. Please try again.');
      setSaving(false);
      return;
    }

    if (anyFailed) {
      setSaving(false);
      return;
    }

    // Every still-incomplete member in scope was just PATCHed to completion. Leave
    // via a HARD navigation rather than refetch + router.push: the refetch races
    // the `use cache` revalidation, and a soft push into the /family gate can read
    // the pre-save (stale) family and bounce back to /complete-profile on the SAME
    // route, preserving this component with saving=true → a permanent "Saving…". A
    // full document load re-runs the gate server-side on fresh data. We
    // intentionally leave saving=true: assign() is async, but the page is
    // unloading imminently and we don't want the button to flicker meanwhile.
    navigateTo('/family');
  }

  if (loading) {
    return (
      <CspRoot style={{ minHeight: '100dvh' }}>
        <LoadingOm padding={48} />
      </CspRoot>
    );
  }

  if (!data) {
    return (
      <CspRoot style={{ minHeight: '100dvh' }}>
        <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
          <p style={{ color: 'var(--err)', fontSize: 14 }}>We couldn&apos;t load your family. Please sign in again.</p>
        </div>
      </CspRoot>
    );
  }

  // Body shared by mobile + desktop.
  const intro = (
    <div style={{ marginBottom: 22 }}>
      <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        Complete your profile
      </p>
      <h1 style={{ fontSize: 26, fontWeight: 600, marginTop: 8, letterSpacing: '-0.02em' }}>
        A few details before you continue
      </h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        {data.isManager
          ? 'We need a little more about your family, including your home address, so sevaks can welcome everyone on Sunday.'
          : 'We need a little more on your profile so sevaks can welcome you on Sunday.'}
      </p>
    </div>
  );

  const memberCards = cards.map(({ member, missing }) => {
    const draft = drafts[member.mid];
    if (!draft) return null;
    // Per-field inline messages, recomputed live and shown only after a blocked
    // Save — so a message clears the moment the user fixes the field.
    const { messages } = validateMember(member, draft);
    const ready = memberReady(member, draft);
    const liveRemaining = whatsMissingForMember(draftToMemberShape(member, draft)).filter(
      (f) => !UNFILLABLE_FIELDS.includes(f),
    );
    const fieldErr = (f: MemberRequiredField) => (showErrors ? messages[f] : undefined);
    // Which fields to render is frozen to the server's missing set at load.
    const show = (f: MemberRequiredField) => missing.includes(f);
    return (
      <div
        key={member.mid}
        data-testid={`member-card-${member.mid}`}
        className="card"
        style={{ padding: 18, marginBottom: 16 }}
      >
        {/* Whose profile this card is for — emphasised so it's unmistakable amid
            the fields (issue #18 #1): large, bold, accent-coloured, with an eyebrow. */}
        <p style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 2 }}>
          {data.isManager ? 'Member' : 'Your profile'}
        </p>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accentDeep)', letterSpacing: '-0.01em', marginBottom: 4 }}>
          {member.firstName} {member.lastName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          {member.type}
          {' · '}
          {ready
            ? 'all set ✓'
            : liveRemaining.length > 0
              ? `still needs ${liveRemaining.map((f) => FIELD_LABEL[f]).join(', ')}`
              : 'almost there — check the highlighted fields'}
        </div>

        {/* firstName / lastName / type have NO input on this screen (they're set
            at registration). If one is somehow missing, the card would otherwise
            render an empty shell with no way forward — explain it instead of
            stranding the user. */}
        {(() => {
          const unfillable = missing.filter((f) => UNFILLABLE_FIELDS.includes(f));
          if (unfillable.length === 0) return null;
          return (
            <p
              data-testid={`member-unfillable-${member.mid}`}
              style={{ fontSize: 12.5, color: 'var(--err)', marginBottom: 14, lineHeight: 1.5 }}
            >
              {unfillable.map((f) => FIELD_LABEL[f]).join(' and ')} can&apos;t be edited here — please
              ask a sevak (welcome team) to update {unfillable.length > 1 ? 'them' : 'it'} so you can
              continue.
            </p>
          );
        })()}

        {show('gender') && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Gender <span className="req">·</span></label>
            <select
              className="input"
              aria-label={`Gender for ${member.firstName}`}
              value={draft.gender}
              onChange={(e) => update(member.mid, { gender: e.target.value as '' | Gender })}
            >
              <option value="" disabled>Select…</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            <FieldError message={fieldErr('gender')} />
          </div>
        )}

        {show('foodAllergies') && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Food allergies <span className="req">·</span></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 8 }}>
              <input
                type="checkbox"
                aria-label={`No known allergies for ${member.firstName}`}
                checked={draft.noAllergies}
                onChange={(e) => update(member.mid, { noAllergies: e.target.checked })}
                style={{ width: 18, height: 18 }}
              />
              No known allergies
            </label>
            {!draft.noAllergies && (
              <input
                className="input"
                aria-label={`Food allergies for ${member.firstName}`}
                value={draft.foodAllergies}
                onChange={(e) => update(member.mid, { foodAllergies: e.target.value })}
                placeholder="e.g. Peanuts"
              />
            )}
            <FieldError message={fieldErr('foodAllergies')} />
          </div>
        )}

        {member.type === 'Adult' && (show('email') || show('phone')) && (
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            {show('email') && (
              <div className="field" style={{ flex: 1 }}>
                <label>Email <span className="req">·</span></label>
                <input
                  className="input"
                  type="email"
                  aria-label={`Email for ${member.firstName}`}
                  value={draft.email}
                  onChange={(e) => update(member.mid, { email: e.target.value })}
                />
                <FieldError message={fieldErr('email')} />
              </div>
            )}
            {show('phone') && (
              <div className="field" style={{ flex: 1 }}>
                <label>Phone <span className="req">·</span></label>
                <input
                  className="input"
                  type="tel"
                  aria-label={`Phone for ${member.firstName}`}
                  value={draft.phone}
                  onChange={(e) => update(member.mid, { phone: e.target.value })}
                />
                <FieldError message={fieldErr('phone')} />
              </div>
            )}
          </div>
        )}

        {show('volunteeringSkills') && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Volunteering skills <span className="req">·</span></label>
            <VolunteeringSkillsPicker
              value={draft.volunteeringSkills}
              onChange={(next) => update(member.mid, { volunteeringSkills: next })}
            />
            {draft.volunteeringSkills.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Select at least one.</p>
            )}
            <FieldError message={fieldErr('volunteeringSkills')} />
          </div>
        )}

        {show('schoolGrade') && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>School grade <span className="req">·</span></label>
            <select
              className="input"
              aria-label={`School grade for ${member.firstName}`}
              value={draft.schoolGrade}
              onChange={(e) => update(member.mid, { schoolGrade: e.target.value })}
            >
              <option value="" disabled>Select grade…</option>
              {CHILD_GRADE_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
            <FieldError message={fieldErr('schoolGrade')} />
          </div>
        )}

        {show('birthMonthYear') && (
          <div className="field" style={{ marginBottom: 4 }}>
            <label>Birth month & year <span className="req">·</span></label>
            <div className="row" style={{ gap: 8 }}>
              <select
                className="input"
                aria-label={`Birth month for ${member.firstName}`}
                value={draft.birthMonth}
                onChange={(e) => update(member.mid, { birthMonth: e.target.value })}
                style={{ flex: 1 }}
              >
                <option value="" disabled>Month</option>
                {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select
                className="input"
                aria-label={`Birth year for ${member.firstName}`}
                value={draft.birthYear}
                onChange={(e) => update(member.mid, { birthYear: e.target.value })}
                style={{ flex: 1 }}
              >
                <option value="" disabled>Year</option>
                {Array.from({ length: 26 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <FieldError message={fieldErr('birthMonthYear')} />
          </div>
        )}
      </div>
    );
  });

  // Positive confirmation once everything in scope is saveable.
  const allSetNote = allReady ? (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <p style={{ fontSize: 14 }}>Everything looks complete — save to continue to your dashboard.</p>
    </div>
  ) : null;

  // Manager-only family home address. Required family-level data, so it renders
  // ONCE (not per member). A missing/invalid address blocks the submit via
  // allReady. Inline errors surface only after a blocked Save (like the members).
  const addressSection = data.isManager ? (
    <div className="card" style={{ padding: 18, marginBottom: 16 }} data-testid="family-address-section">
      <SectionLabel>Home address</SectionLabel>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Street <span className="req">·</span></label>
        <input
          className="input"
          type="text"
          aria-label="Street address"
          value={street}
          onChange={(e) => setStreet(e.target.value)}
        />
        <FieldError message={showErrors && !street.trim() ? 'Street is required.' : undefined} />
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Unit <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
        <input
          className="input"
          type="text"
          aria-label="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>City <span className="req">·</span></label>
        <input
          className="input"
          type="text"
          aria-label="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <FieldError message={showErrors && !city.trim() ? 'City is required.' : undefined} />
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Province <span className="req">·</span></label>
        <ProvinceSelect value={province} onChange={setProvince} />
        <FieldError message={showErrors && !province.trim() ? 'Province is required.' : undefined} />
      </div>
      <div className="field" style={{ marginBottom: 4 }}>
        <label>Postal code <span className="req">·</span></label>
        <input
          className="input"
          type="text"
          aria-label="Postal code"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
        />
        <FieldError
          message={showErrors && !CANADIAN_POSTAL_RE.test(postalCode.trim()) ? 'Enter a valid postal code (A1A 1A1).' : undefined}
        />
      </div>
    </div>
  ) : null;

  // The button stays ALWAYS clickable (except while saving): clicking it while
  // incomplete surfaces inline errors + a toast (issue #18 #4), rather than
  // silently doing nothing — the prior `disabled={!allComplete}` gave no feedback.
  const submitBtn = (
    <button type="submit" className="btn btn--p btn--block" disabled={saving} data-testid="complete-profile-save">
      {saving ? 'Saving…' : 'Save and continue'}
    </button>
  );

  return (
    <form onSubmit={handleSubmit}>
      {/* Mobile — standalone full-screen (this is a top-level /complete-profile
          route, NOT under the /family sidebar chrome). */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '20px 18px 110px', minHeight: '100dvh' }}>
            <div style={{ marginBottom: 18 }}><SetuLogo size={18} /></div>
            {intro}
            {allSetNote}
            {addressSection}
            {memberCards}
          </div>
          <div className="csp" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
            {submitBtn}
          </div>
        </CspRoot>
      </div>

      {/* Desktop — standalone, centered focused screen (no family sidebar). */}
      <div className="hidden md:block">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ maxWidth: 600, margin: '0 auto', padding: '56px 24px 72px' }}>
            <div style={{ marginBottom: 30 }}><SetuLogo size={22} /></div>
            {intro}
            {allSetNote}
            {addressSection}
            {memberCards}
            <div style={{ marginTop: 8 }}>{submitBtn}</div>
          </div>
        </CspRoot>
      </div>
    </form>
  );
}
