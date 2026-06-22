'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@cmt/ui';
import {
  whatsMissingForMember,
  isMemberComplete,
  incompleteMembers,
  NO_ALLERGIES,
  type MemberRequiredField,
} from '@cmt/shared-domain';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import { CspRoot, FieldError } from '@/features/family/components/atoms';
import { VolunteeringSkillsPicker } from '@/features/setu/members/volunteering-skills-picker';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import { patchMemberClient } from '@/features/setu/members/patch-member-client';
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

/**
 * Self-contained profile-completion form. Loads the current family, and for the
 * members the signed-in person is responsible for (a manager → every incomplete
 * member; a plain member → only their own record), renders ONLY the missing
 * required fields. On Save, PATCHes each member; when nothing is missing
 * anymore it returns to /family.
 *
 * Completeness is judged by the shared @cmt/shared-domain helpers so this screen
 * agrees exactly with the gate that sent the user here and with the write route.
 */
export function CompleteProfileForm() {
  const router = useRouter();
  const [data, setData] = useState<FamilyWithMembers | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({});
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    getCurrentFamilyClient()
      .then((result) => {
        if (result) {
          setData(result);
          const seeded: Record<string, MemberDraft> = {};
          for (const m of result.members) seeded[m.mid] = seedDraft(m);
          setDrafts(seeded);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // The members this person must complete + what each still needs, recomputed
  // live as the drafts change so completed fields disappear from the form.
  const targets = useMemo(() => {
    if (!data) return [] as { member: MemberDoc; missing: MemberRequiredField[] }[];
    // Scope: manager → all incomplete members; plain member → own record only.
    const scoped = data.isManager
      ? data.members
      : data.members.filter((m) => m.mid === data.currentMid);
    return scoped
      .map((member) => {
        const draft = drafts[member.mid];
        // Until a draft is seeded, fall back to the member's stored values.
        const shape = draft ? draftToMemberShape(member, draft) : member;
        return { member, missing: whatsMissingForMember(shape) };
      })
      .filter((t) => t.missing.length > 0);
  }, [data, drafts]);

  // Whether everything in scope is now complete (drives the redirect + button).
  const allComplete = useMemo(() => {
    if (!data) return false;
    const scoped = data.isManager
      ? data.members
      : data.members.filter((m) => m.mid === data.currentMid);
    return scoped.every((member) => {
      const draft = drafts[member.mid];
      const shape = draft ? draftToMemberShape(member, draft) : member;
      return isMemberComplete(shape);
    });
  }, [data, drafts]);

  function update(mid: string, patch: Partial<MemberDraft>) {
    setDrafts((prev) => {
      const cur = prev[mid];
      if (!cur) return prev;
      return { ...prev, [mid]: { ...cur, ...patch } };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setSaving(true);
    setFieldErrors({});

    // PATCH every member still in scope (manager → all; member → self). We send
    // the member's current type so the write route's effectiveType picks the
    // right required matrix; we only send the completion-screen fields.
    const scoped = data.isManager
      ? data.members
      : data.members.filter((m) => m.mid === data.currentMid);

    const errors: Record<string, Record<string, string>> = {};
    let anyFailed = false;

    for (const member of scoped) {
      const draft = drafts[member.mid];
      if (!draft) continue;
      const shape = draftToMemberShape(member, draft);
      // Skip members that are already complete — nothing to write.
      if (isMemberComplete(shape)) continue;

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
        if (result.fields) errors[member.mid] = result.fields;
        else toast.error(memberWriteErrorMessage({ error: result.error }));
      }
    }

    if (anyFailed) {
      setFieldErrors(errors);
      setSaving(false);
      return;
    }

    // Refetch so completeness reflects what's actually persisted, then either
    // re-render the (now smaller) form or go to the dashboard.
    const refreshed = await getCurrentFamilyClient().catch(() => null);
    if (refreshed) {
      const stillScoped = refreshed.isManager
        ? incompleteMembers(refreshed.members)
        : (() => {
            const me = refreshed.members.find((m) => m.mid === refreshed.currentMid);
            return me && !isMemberComplete(me) ? [{ mid: me.mid, missing: [] }] : [];
          })();
      if (stillScoped.length === 0) {
        router.push('/family');
        router.refresh();
        return;
      }
      setData(refreshed);
      const seeded: Record<string, MemberDraft> = {};
      for (const m of refreshed.members) seeded[m.mid] = seedDraft(m);
      setDrafts(seeded);
    } else {
      router.push('/family');
      router.refresh();
      return;
    }
    setSaving(false);
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
          ? 'We need a little more for each family member so sevaks can welcome everyone on Sunday.'
          : 'We need a little more on your profile so sevaks can welcome you on Sunday.'}
      </p>
    </div>
  );

  const memberCards = targets.map(({ member, missing }) => {
    const draft = drafts[member.mid];
    if (!draft) return null;
    const errs = fieldErrors[member.mid] ?? {};
    const show = (f: MemberRequiredField) => missing.includes(f);
    return (
      <div
        key={member.mid}
        data-testid={`member-card-${member.mid}`}
        className="card"
        style={{ padding: 18, marginBottom: 16 }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          {member.firstName} {member.lastName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          {member.type} · still needs {missing.map((f) => FIELD_LABEL[f]).join(', ')}
        </div>

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
            <FieldError message={errs.gender} />
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
            <FieldError message={errs.foodAllergies} />
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
                <FieldError message={errs.email} />
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
                <FieldError message={errs.phone} />
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
            <FieldError message={errs.volunteeringSkills} />
          </div>
        )}

        {show('schoolGrade') && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>School grade <span className="req">·</span></label>
            <input
              className="input"
              aria-label={`School grade for ${member.firstName}`}
              value={draft.schoolGrade}
              onChange={(e) => update(member.mid, { schoolGrade: e.target.value })}
              placeholder="e.g. Grade 3"
            />
            <FieldError message={errs.schoolGrade} />
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
            <FieldError message={errs.birthMonthYear} />
          </div>
        )}
      </div>
    );
  });

  // Defensive: gate sent the user here, but if everything's already complete
  // (e.g. completed in another tab), offer a way back rather than an empty form.
  const emptyState = targets.length === 0 ? (
    <div className="card" style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ fontSize: 14, marginBottom: 14 }}>Your family profile is complete.</p>
      <button
        type="button"
        className="btn btn--p"
        onClick={() => { router.push('/family'); router.refresh(); }}
      >
        Go to dashboard
      </button>
    </div>
  ) : null;

  const submitBtn = targets.length > 0 ? (
    <button type="submit" className="btn btn--p btn--block" disabled={saving || !allComplete}>
      {saving ? 'Saving…' : 'Save and continue'}
    </button>
  ) : null;

  return (
    <form onSubmit={handleSubmit}>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '18px 18px 110px', minHeight: '100dvh' }}>
            {intro}
            {emptyState}
            {memberCards}
          </div>
          {submitBtn && (
            <div className="csp" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              {submitBtn}
            </div>
          )}
        </CspRoot>
      </div>

      {/* Desktop — family layout owns the sidebar + main wrapper */}
      <div className="hidden md:block">
        <div style={{ maxWidth: 640 }}>
          {intro}
          {emptyState}
          {memberCards}
          {targets.length > 0 && (
            <div style={{ marginTop: 8 }}>{submitBtn}</div>
          )}
        </div>
      </div>
    </form>
  );
}
