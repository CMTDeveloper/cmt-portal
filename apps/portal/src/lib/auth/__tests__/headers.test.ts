import { describe, it, expect } from 'vitest';
import { readSessionFromHeaders } from '../headers';

function makeReq(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/test', { headers });
}

describe('readSessionFromHeaders', () => {
  it('returns null when x-portal-uid is missing', () => {
    const result = readSessionFromHeaders(makeReq({ 'x-portal-role': 'admin' }));
    expect(result).toBeNull();
  });

  it('returns null when x-portal-role is missing', () => {
    const result = readSessionFromHeaders(makeReq({ 'x-portal-uid': 'uid-1' }));
    expect(result).toBeNull();
  });

  it('returns null when x-portal-role is not a valid Role', () => {
    const result = readSessionFromHeaders(makeReq({ 'x-portal-uid': 'uid-1', 'x-portal-role': 'hacker' }));
    expect(result).toBeNull();
  });

  it('returns session with empty extraRoles when header absent', () => {
    const result = readSessionFromHeaders(makeReq({ 'x-portal-uid': 'uid-1', 'x-portal-role': 'admin' }));
    expect(result).not.toBeNull();
    expect(result!.uid).toBe('uid-1');
    expect(result!.role).toBe('admin');
    expect(result!.extraRoles).toEqual([]);
    expect(result!.fid).toBeNull();
    expect(result!.mid).toBeNull();
  });

  it('parses comma-separated extraRoles, filtering invalid values', () => {
    const result = readSessionFromHeaders(makeReq({
      'x-portal-uid': 'uid-2',
      'x-portal-role': 'family-manager',
      'x-portal-extra-roles': 'admin, not-a-role, welcome-team',
    }));
    expect(result!.extraRoles).toEqual(['admin', 'welcome-team']);
  });

  it('returns fid and mid when present', () => {
    const result = readSessionFromHeaders(makeReq({
      'x-portal-uid': 'uid-3',
      'x-portal-role': 'family-manager',
      'x-portal-fid': 'CMT-FAM-001',
      'x-portal-mid': 'mid-abc',
    }));
    expect(result!.fid).toBe('CMT-FAM-001');
    expect(result!.mid).toBe('mid-abc');
  });

  it('returns fid null and mid null when absent', () => {
    const result = readSessionFromHeaders(makeReq({
      'x-portal-uid': 'uid-4',
      'x-portal-role': 'admin',
    }));
    expect(result!.fid).toBeNull();
    expect(result!.mid).toBeNull();
  });
});
