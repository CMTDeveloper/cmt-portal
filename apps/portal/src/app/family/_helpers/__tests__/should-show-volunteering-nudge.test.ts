import { describe, it, expect } from 'vitest';
import { shouldShowVolunteeringSkillsNudge } from '../should-show-volunteering-nudge';

describe('shouldShowVolunteeringSkillsNudge', () => {
  it('shows for an adult with no skills and no dismissal', () => {
    expect(shouldShowVolunteeringSkillsNudge({ type: 'Adult', volunteeringSkills: [] })).toBe(true);
  });

  it('treats absent volunteeringSkills as empty (show)', () => {
    expect(shouldShowVolunteeringSkillsNudge({ type: 'Adult' })).toBe(true);
  });

  it('hides once the adult has at least one skill', () => {
    expect(
      shouldShowVolunteeringSkillsNudge({ type: 'Adult', volunteeringSkills: ['Teaching'] }),
    ).toBe(false);
  });

  it('hides when dismissed', () => {
    expect(
      shouldShowVolunteeringSkillsNudge({
        type: 'Adult',
        volunteeringSkills: [],
        volunteeringSkillsNudgeDismissedAt: new Date(),
      }),
    ).toBe(false);
  });

  it('never shows for a child', () => {
    expect(shouldShowVolunteeringSkillsNudge({ type: 'Child', volunteeringSkills: [] })).toBe(false);
  });

  it('does not show for an absent member', () => {
    expect(shouldShowVolunteeringSkillsNudge(undefined)).toBe(false);
  });

  it('treats null dismissal as not-dismissed (show)', () => {
    expect(
      shouldShowVolunteeringSkillsNudge({
        type: 'Adult',
        volunteeringSkills: [],
        volunteeringSkillsNudgeDismissedAt: null,
      }),
    ).toBe(true);
  });
});
