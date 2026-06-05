import { describe, it, expect } from 'vitest';
import { shouldShowContactsNudge } from '../should-show-contacts-nudge';

describe('shouldShowContactsNudge', () => {
  it('shows when the member has not dismissed it', () => {
    expect(shouldShowContactsNudge({ contactsNudgeDismissedAt: null })).toBe(true);
    expect(shouldShowContactsNudge({})).toBe(true);
  });
  it('hides when dismissed', () => {
    expect(shouldShowContactsNudge({ contactsNudgeDismissedAt: new Date() })).toBe(false);
  });
  it('hides when there is no member', () => {
    expect(shouldShowContactsNudge(undefined)).toBe(false);
  });
});
