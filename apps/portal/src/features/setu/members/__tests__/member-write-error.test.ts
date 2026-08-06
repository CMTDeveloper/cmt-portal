import { describe, it, expect } from 'vitest';
import { canAccessRoute, type SessionClaims } from '@cmt/shared-domain';
import { memberWriteErrorMessage } from '../member-write-error';

describe('memberWriteErrorMessage', () => {
  it('maps a known code to friendly copy, never the raw code', () => {
    expect(memberWriteErrorMessage({ error: 'contact-required' })).toBe(
      'Adults need both an email and a phone number.',
    );
  });

  it('falls back for an unknown code rather than rendering undefined', () => {
    expect(memberWriteErrorMessage({ error: 'something-new' })).toBe(
      'Something went wrong. Please try again.',
    );
    expect(memberWriteErrorMessage({})).toBe('Something went wrong. Please try again.');
  });

  it('spells out zod issues for bad-request', () => {
    const msg = memberWriteErrorMessage({
      error: 'bad-request',
      issues: [{ path: ['email'], message: 'Invalid email' }],
    });
    expect(msg).toContain('email: Invalid email');
  });

  it('names the offending field for a duplicate contact', () => {
    expect(memberWriteErrorMessage({ error: 'contact-already-registered', field: 'phone' })).toContain(
      'This phone is already linked to another family',
    );
  });
});

describe('memberWriteErrorMessage - audience', () => {
  const code = { error: 'enrolled-cannot-deactivate' };

  it('tells a FAMILY manager to cancel the enrollment themselves', () => {
    expect(memberWriteErrorMessage(code, 'family')).toContain('Cancel that enrollment first');
  });

  it('defaults to the family wording when no audience is given', () => {
    expect(memberWriteErrorMessage(code)).toBe(memberWriteErrorMessage(code, 'family'));
  });

  it('tells STAFF that an admin has to do it', () => {
    const msg = memberWriteErrorMessage(code, 'staff');
    expect(msg).toContain('An admin needs to cancel that enrollment');
    // And must NOT carry the family instruction, which for staff is an
    // instruction to attempt something the server refuses.
    expect(msg).not.toContain('Cancel that enrollment first');
  });

  // The staff copy makes a CLAIM about authorization - "the front desk cannot".
  // Pinned against the real rule rather than trusted as prose: if unenrollment
  // is ever widened to welcome-team, this fails and the copy gets revisited,
  // instead of quietly telling staff to go and find an admin they don't need.
  it('the claim it makes is true: welcome-team really cannot clear an enrollment', () => {
    const welcome: SessionClaims = { uid: 'w', role: 'welcome-team' };
    const admin: SessionClaims = { uid: 'a', role: 'admin' };
    expect(canAccessRoute(welcome, '/api/welcome/enrollments/e1', 'DELETE')).toBe(false);
    expect(canAccessRoute(welcome, '/api/welcome/enrollments/e1/override', 'POST')).toBe(false);
    expect(canAccessRoute(admin, '/api/welcome/enrollments/e1', 'DELETE')).toBe(true);
  });

  it('leaves every other code identical for both audiences', () => {
    // The split is deliberately ONE code. A second one appearing without a
    // test is the drift this asserts against.
    for (const c of [
      'contact-required',
      'last-manager',
      'last-manager-cannot-deactivate',
      'manager-must-be-adult',
      'grade-required',
      'forbidden',
    ]) {
      expect(memberWriteErrorMessage({ error: c }, 'staff')).toBe(
        memberWriteErrorMessage({ error: c }, 'family'),
      );
    }
  });
});
