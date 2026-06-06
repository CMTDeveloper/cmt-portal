'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { VolunteeringSkillsPicker } from '@/features/setu/members/volunteering-skills-picker';
import {
  saveVolunteeringSkills,
  dismissVolunteeringSkillsNudge,
} from '@/features/setu/members/volunteering-skills-client';

/**
 * One-time post-sign-in nudge inviting the signed-in adult member to set their
 * volunteering skills, inline (picker + Save) on the dashboard. Shown only when
 * the member has no skills yet and hasn't dismissed it (gated server-side by
 * shouldShowVolunteeringSkillsNudge). Saving or dismissing both clear the gate.
 */
export function VolunteeringSkillsNudge({ mid }: { mid: string }) {
  const [skills, setSkills] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [hidden, setHidden] = useState(false);

  async function handleSave() {
    if (skills.length === 0) return;
    setSaving(true);
    const res = await saveVolunteeringSkills(mid, skills);
    setSaving(false);
    if (res.ok) {
      setHidden(true);
    } else {
      toast.error('Could not save your skills. Please try again.');
    }
  }

  async function handleDismiss() {
    setHidden(true);
    // Fire-and-forget persistence; the local hide is the user-facing effect.
    await dismissVolunteeringSkillsNudge().catch(() => {});
  }

  if (hidden) return null;

  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--accentSoft)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius)',
        marginBottom: 18,
      }}
    >
      <div className="between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accentDeep)' }}>
            How would you like to help?
          </div>
          <div style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 2, lineHeight: 1.5 }}>
            Pick any volunteering skills you can offer — it helps us reach the right people for seva.
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={saving}
          aria-label="Dismiss"
          style={{ background: 'transparent', border: 0, color: 'var(--muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4 }}
        >
          ×
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <VolunteeringSkillsPicker value={skills} onChange={setSkills} />
      </div>

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button type="button" className="btn btn--p btn--s" onClick={handleSave} disabled={saving || skills.length === 0}>
          {saving ? 'Saving…' : 'Save skills'}
        </button>
        <button type="button" className="btn btn--g btn--s" onClick={handleDismiss} disabled={saving}>
          Not now
        </button>
      </div>
    </div>
  );
}
