import { describe, it, expect } from 'vitest';
import { enrollErrorMessage } from '../enroll-client';

/**
 * `no-eligible-members` gained a SECOND cause on 2026-08-03.
 *
 * It used to mean one thing: the family has no children. Now a family can have
 * children and still hit it, because `enrollFamily` filters anyone marked "no
 * longer participating" - and the lazy migration marks a child inactive at
 * import when the legacy roster had no class level for them.
 *
 * So "Add a child to your family" could be shown to a family looking at the
 * child it had just listed, with no hint that the child was marked as finished
 * or where to undo it. The message has to cover both causes.
 */
describe('enrollErrorMessage — no-eligible-members', () => {
  const msg = enrollErrorMessage('no-eligible-members');

  it('does not tell a family to add a child they may already have', () => {
    expect(msg).not.toMatch(/^Add a child to your family before enrolling/);
  });

  it('names the participation cause and where to fix it', () => {
    expect(msg).toMatch(/taking part/i);
    expect(msg).toMatch(/My family/i);
  });

  it('still offers the add-a-child route, for the family that genuinely has none', () => {
    expect(msg).toMatch(/add a child/i);
  });

  it('leaves the other messages alone', () => {
    expect(enrollErrorMessage('no-selectable-adults')).toMatch(/already teaching/i);
    expect(enrollErrorMessage('program-not-available')).toMatch(/not available/i);
    expect(enrollErrorMessage(undefined)).toMatch(/try again/i);
  });
});
