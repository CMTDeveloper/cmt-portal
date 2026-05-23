import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: vi.fn(),
}));

vi.mock('../get-family-by-fid', () => ({
  getFamilyByFid: vi.fn(),
}));

import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { getFamilyByFid } from '../get-family-by-fid';
import { getCurrentFamily } from '../get-current-family';

const mockCookies = vi.mocked(cookies);
const mockVerify = vi.mocked(verifyPortalSessionCookie);
const mockGetFamilyByFid = vi.mocked(getFamilyByFid);

function makeCookieStore(value: string | undefined) {
  return {
    get: (_name: string) => (value ? { value } : undefined),
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never;
}

const managerClaims = {
  uid: 'uid-001',
  role: 'family-manager' as const,
  fid: 'fam-001',
  mid: 'fam-001-01',
};

const memberClaims = {
  uid: 'uid-002',
  role: 'family-member' as const,
  fid: 'fam-001',
  mid: 'fam-001-02',
};

const familyAndMembers = {
  family: {
    fid: 'fam-001',
    legacyFid: null,
    name: 'Patel',
    location: 'Brampton',
    createdAt: new Date('2024-01-01'),
    managers: ['fam-001-01'],
    searchKeys: ['patel'],
  },
  members: [
    {
      mid: 'fam-001-01',
      uid: 'uid-001',
      firstName: 'Aarti',
      lastName: 'Patel',
      type: 'Adult',
      gender: 'Female',
      manager: true,
      joinedAt: new Date('2024-01-01'),
      email: 'aarti@example.com',
      phone: null,
      schoolGrade: null,
      birthMonthYear: null,
      volunteeringSkills: [],
      foodAllergies: null,
      emergencyContacts: [null, null],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCurrentFamily', () => {
  it('returns null when no session cookie', async () => {
    mockCookies.mockResolvedValue(makeCookieStore(undefined) as never);
    const result = await getCurrentFamily();
    expect(result).toBeNull();
  });

  it('returns null when cookie is invalid', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('bad-cookie') as never);
    mockVerify.mockResolvedValue(null);
    const result = await getCurrentFamily();
    expect(result).toBeNull();
  });

  it('returns null for legacy family role', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('valid') as never);
    mockVerify.mockResolvedValue({
      uid: 'uid-legacy',
      role: 'family',
      familyId: '4421',
    } as never);
    const result = await getCurrentFamily();
    expect(result).toBeNull();
  });

  it('returns family+members for family-manager', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('valid') as never);
    mockVerify.mockResolvedValue(managerClaims as never);
    mockGetFamilyByFid.mockResolvedValue(familyAndMembers as never);

    const result = await getCurrentFamily();
    expect(result).not.toBeNull();
    expect(result!.family.name).toBe('Patel');
    expect(result!.isManager).toBe(true);
    expect(result!.currentMid).toBe('fam-001-01');
    expect(result!.members).toHaveLength(1);
  });

  it('returns family+members for family-member with isManager=false', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('valid') as never);
    mockVerify.mockResolvedValue(memberClaims as never);
    mockGetFamilyByFid.mockResolvedValue(familyAndMembers as never);

    const result = await getCurrentFamily();
    expect(result).not.toBeNull();
    expect(result!.isManager).toBe(false);
    expect(result!.currentMid).toBe('fam-001-02');
  });

  it('returns null when family doc does not exist', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('valid') as never);
    mockVerify.mockResolvedValue(managerClaims as never);
    mockGetFamilyByFid.mockResolvedValue(null);

    const result = await getCurrentFamily();
    expect(result).toBeNull();
  });
});
