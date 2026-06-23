'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast, SetuLogo } from '@cmt/ui';
import {
  whatsMissingForMember,
  isMemberComplete,
  NO_ALLERGIES,
  type MemberRequiredField,
} from '@cmt/shared-domain';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import { CspRoot, FieldError } from '@/features/family/components/atoms';
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
  const [data, setData] = useState<FamilyWithMembers | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({});
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});

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
        if (scoped.every((m) => isMemberComplete(m))) {
          navigateTo('/family');
          return;
        }
        setData(result);
        const seeded: Record<string, MemberDraft> = {};
        for (const m of result.members) seeded[m.mid] = seedDraft(m);
        setDrafts(seeded);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

    try {
      for (const member of scoped) {
        const draft = drafts[member.mid];
        if (!draft) continue;
        // Skip members whose SERVER record is already complete — only the members
        // the gate flagged need a write. (Checking the DRAFT here was a bug: the
        // user has JUST completed the draft, so it always looked complete and the
        // PATCH was skipped, persisting nothing and looping the gate.)
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
          if (result.fields) errors[member.mid] = result.fields;
          else toast.error(memberWriteErrorMessage({ error: result.error }));
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
      setFieldErrors(errors);
      setSaving(false);
      return;
    }

    // Every still-incomplete member in scope was just PATCHed to completion — the
    // Save button only enables once every scoped member is complete by draft, and
    // a 200 from the write route means that member now satisfies the matrix — so
    // the family is now complete. Leave via a HARD navigation rather than refetch
    // + router.push: the refetch races the `use cache` revalidation, and a soft
    // push into the /family gate can read the pre-save (stale) family and bounce
    // back to /complete-profile on the SAME route, preserving this component with
    // saving=true → a permanent "Saving…". A full document load re-runs the gate
    // server-side on fresh data. We intentionally leave saving=true: assign() is
    // async, but the page is unloading imminently and we don't want the button to
    // flicker back to "Save and continue" in the meantime.
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

        {/* firstName / lastName / type have NO input on this screen (they're set
            at registration). If one is somehow missing, the card would otherwise
            render an empty shell with a permanently-disabled Save and no way
            forward — explain it instead of stranding the user. */}
        {(() => {
          const unfillable = missing.filter(
            (f) => f === 'firstName' || f === 'lastName' || f === 'type',
          );
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

  // As the user fills fields, satisfied fields (and eventually whole member
  // cards) drop out of `targets` — so once everything is filled `targets` is
  // empty. That's the moment we MOST need the Save button (to PATCH the drafts),
  // so the button is ALWAYS rendered here; it just toggles enabled on
  // `allComplete`. Gating its existence on `targets.length > 0` (as before) made
  // it vanish exactly when it became clickable, leaving no way to save.
  const allSetNote = targets.length === 0 ? (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <p style={{ fontSize: 14 }}>Everything looks complete — save to continue to your dashboard.</p>
    </div>
  ) : null;

  const submitBtn = (
    <button type="submit" className="btn btn--p btn--block" disabled={saving || !allComplete} data-testid="complete-profile-save">
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
            {memberCards}
            <div style={{ marginTop: 8 }}>{submitBtn}</div>
          </div>
        </CspRoot>
      </div>
    </form>
  );
}
