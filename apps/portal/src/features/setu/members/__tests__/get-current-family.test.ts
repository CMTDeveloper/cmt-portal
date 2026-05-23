import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getCurrentFamily } from '../get-current-family';

const mockCookies = vi.mocked(cookies);
const mockVerify = vi.mocked(verifyPortalSessionCookie);
const mockFirestore = vi.mocked(portalFirestore);

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

const familyDocData = {
  fid: 'fam-001',
  legacyFid: null,
  name: 'Patel',
  location: 'Brampton',
  createdAt: { toDate: () => new Date('2024-01-01') },
  managers: ['fam-001-01'],
  searchKeys: ['patel'],
};

const memberDocData = {
  mid: 'fam-001-01',
  uid: 'uid-001',
  firstName: 'Aarti',
  lastName: 'Patel',
  type: 'Adult',
  gender: 'Female',
  manager: true,
  joinedAt: { toDate: () => new Date('2024-01-01') },
  email: 'aarti@example.com',
  phone: null,
  schoolGrade: null,
  birthMonthYear: null,
  volunteeringSkills: [],
  foodAllergies: null,
  emergencyContacts: [null, null],
};

function makeFirestoreDb(familyExists = true) {
  return {
    collection: (_col: string) => ({
      doc: (_id: string) => ({
        get: vi.fn().mockResolvedValue({
          exists: familyExists,
          data: () => (familyExists ? familyDocData : undefined),
        }),
        collection: (_sub: string) => ({
          get: vi.fn().mockResolvedValue({
            docs: [{ data: () => memberDocData }],
          }),
        }),
      }),
    }),
  };
}

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
    mockFirestore.mockReturnValue(makeFirestoreDb(true) as never);

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
    mockFirestore.mockReturnValue(makeFirestoreDb(true) as never);

    const result = await getCurrentFamily();
    expect(result).not.toBeNull();
    expect(result!.isManager).toBe(false);
    expect(result!.currentMid).toBe('fam-001-02');
  });

  it('returns null when family doc does not exist', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('valid') as never);
    mockVerify.mockResolvedValue(managerClaims as never);
    mockFirestore.mockReturnValue(makeFirestoreDb(false) as never);

    const result = await getCurrentFamily();
    expect(result).toBeNull();
  });
});
