import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Staff edit of family-level fields: PATCH /api/welcome/families/[fid] */

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

const mockGetLocationOptions = vi.hoisted(() => vi.fn());
vi.mock('@/lib/locations', () => ({ getLocationOptions: mockGetLocationOptions }));

import { PATCH } from '../route';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { makeFakeDb, auditRows } from '@/features/setu/members/__tests__/fake-member-db';

const TARGET_FID = 'FAMTARGET001';
const STAFF_FID = 'FAMSTAFF0002';

function staffHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-portal-role': 'welcome-team',
    'x-portal-uid': 'uid-staff',
    'x-portal-mid': `${STAFF_FID}-01`,
    'x-portal-fid': STAFF_FID,
    ...extra,
  };
}

function makeRequest(body: unknown, headers: Record<string, string>) {
  return new Request(`http://localhost/api/welcome/families/${TARGET_FID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ fid: TARGET_FID }) };

const ADDRESS = {
  street: '12 Temple Rd',
  unit: '',
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M1M 1M1',
};

function useDb(docs: Record<string, unknown>) {
  const fake = makeFakeDb(docs);
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue(fake.db);
  return fake;
}

function seed(family: Record<string, unknown> = {}) {
  return {
    [`families/${TARGET_FID}`]: {
      fid: TARGET_FID,
      name: 'Patel',
      location: 'Brampton',
      managers: [`${TARGET_FID}-01`],
      searchKeys: ['patel', TARGET_FID.toLowerCase()],
      ...family,
    },
    [`families/${STAFF_FID}`]: { fid: STAFF_FID, name: 'Staff', managers: [`${STAFF_FID}-01`] },
  };
}

beforeEach(() => {
  mockGetLocationOptions.mockResolvedValue(['Brampton', 'Scarborough']);
  vi.clearAllMocks();
});

describe('PATCH /api/welcome/families/[fid]', () => {
  it('returns 401 with no session', async () => {
    useDb(seed());
    const res = await PATCH(makeRequest({ name: 'Shah' }, { 'content-type': 'application/json' }), ctx);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a plain family-manager', async () => {
    useDb(seed());
    const res = await PATCH(
      makeRequest({ name: 'Shah' }, staffHeaders({ 'x-portal-role': 'family-manager' })),
      ctx,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
  });

  // Was "returns 403 for a coordinator" (spec 3.1 granted coordinator family
  // READ but not family EDIT). Reversed 2026-08-05: coordinator inherits the
  // whole welcome-team grant, so it reaches this handler like any other
  // welcome-team caller.
  it('returns 200 for a coordinator - it inherits welcome-team', async () => {
    useDb(seed());
    const res = await PATCH(makeRequest({ name: 'Shah' }, staffHeaders({ 'x-portal-role': 'coordinator' })), ctx);
    expect(res.status).toBe(200);
  });

  it('returns 200 for welcome-team and writes to the ROUTE fid', async () => {
    const { writes } = useDb(seed());
    const res = await PATCH(makeRequest({ location: 'Scarborough' }, staffHeaders()), ctx);

    expect(res.status).toBe(200);
    const familyWrite = writes.find((w) => w.path === `families/${TARGET_FID}`);
    expect(familyWrite?.data).toMatchObject({ location: 'Scarborough' });
    expect(writes.some((w) => w.path === `families/${STAFF_FID}`)).toBe(false);
  });

  it('returns 200 for a volunteer whose PRIMARY role is family-manager', async () => {
    useDb(seed());
    const res = await PATCH(
      makeRequest(
        { location: 'Scarborough' },
        staffHeaders({ 'x-portal-role': 'family-manager', 'x-portal-extra-roles': 'welcome-team' }),
      ),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it('adds the new name to searchKeys so the family stays findable', async () => {
    // searchKeys is what welcome-team family search matches on
    // (array-contains). Renaming without extending it makes the family
    // unsearchable by the name now shown on every screen.
    const { writes } = useDb(seed());
    await PATCH(makeRequest({ name: 'Shah' }, staffHeaders()), ctx);

    const familyWrite = writes.find((w) => w.path === `families/${TARGET_FID}`);
    expect(familyWrite?.data['searchKeys']).toContain('shah');
  });

  it('keeps the old search keys, so a rename never makes a family unfindable', async () => {
    // Additive on purpose. The array is deduped across the family name AND
    // member names, so deleting the old value can drop a key that a member
    // name also justified. A stale key is the better failure.
    const { writes } = useDb(seed({ searchKeys: ['patel', 'diya patel', TARGET_FID.toLowerCase()] }));
    await PATCH(makeRequest({ name: 'Shah' }, staffHeaders()), ctx);

    const keys = writes.find((w) => w.path === `families/${TARGET_FID}`)?.data['searchKeys'] as string[];
    expect(keys).toEqual(expect.arrayContaining(['patel', 'diya patel', 'shah']));
  });

  it('writes an audit row naming the staff member', async () => {
    const { writes } = useDb(seed());
    await PATCH(makeRequest({ location: 'Scarborough' }, staffHeaders()), ctx);

    const rows = auditRows(writes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'family.update',
      actorUid: 'uid-staff',
      actorRole: 'welcome-team',
      fid: TARGET_FID,
      mid: null,
      after: { location: 'Scarborough' },
    });
    expect((rows[0] as { before: Record<string, unknown> }).before).toMatchObject({
      location: 'Brampton',
    });
  });

  it('accepts the home address and the family emergency contact', async () => {
    const { writes } = useDb(seed());
    const res = await PATCH(
      makeRequest(
        { familyAddress: ADDRESS, familyEmergencyContact: { relation: 'Uncle', phone: '4165550000', email: '' } },
        staffHeaders(),
      ),
      ctx,
    );

    expect(res.status).toBe(200);
    const familyWrite = writes.find((w) => w.path === `families/${TARGET_FID}`);
    expect(familyWrite?.data).toMatchObject({ familyAddress: ADDRESS });
  });

  it('rejects an attempt to patch managers or fid', async () => {
    // The schema is strict: managers is maintained by the member routes' own
    // last-manager guard, and rewriting it here would route around that.
    useDb(seed());
    const res = await PATCH(makeRequest({ managers: [] }, staffHeaders()), ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for an empty patch', async () => {
    useDb(seed());
    const res = await PATCH(makeRequest({}, staffHeaders()), ctx);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a family that does not exist', async () => {
    useDb({});
    const res = await PATCH(makeRequest({ location: 'Scarborough' }, staffHeaders()), ctx);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the setu flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { PATCH: flagged } = await import('../route');
    const res = await flagged(makeRequest({ location: 'Scarborough' }, staffHeaders()), ctx);
    expect(res.status).toBe(404);
  });

  // The centre a family attends drives level matching, teacher rosters and the
  // roster filters. The family's OWN PATCH route validates it against the
  // admin-managed options; this sibling route reaches the same field, so
  // without the same check the validation is simply bypassable one route over.
  describe('location', () => {
    it('rejects a centre that is not in the admin-managed options', async () => {
      const fake = useDb(seed());
      const res = await PATCH(makeRequest({ location: 'Atlantis' }, staffHeaders()), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('unknown-location');
      expect(fake.writes.length).toBe(0);
    });

    // Spec 1.9c: welcome-team correcting a wrongly-migrated centre is the stated
    // remedy for an ACTIVE family whose legacy centre is wrong. If the staff fix
    // leaves the flag set, the family is still diverted to /complete-profile at
    // next sign-in and asked to pick again - overriding what staff just set.
    it('clears locationNeedsConfirmation when staff set the centre', async () => {
      const fake = useDb(seed({ locationNeedsConfirmation: true }));
      const res = await PATCH(makeRequest({ location: 'Scarborough' }, staffHeaders()), ctx);
      expect(res.status).toBe(200);
      const familyWrite = fake.writes.find((w) => w.path === `families/${TARGET_FID}`);
      expect(familyWrite?.data).toMatchObject({
        location: 'Scarborough',
        locationNeedsConfirmation: false,
      });
    });

    it('leaves the flag untouched on a patch that does not mention location', async () => {
      const fake = useDb(seed({ locationNeedsConfirmation: true }));
      await PATCH(makeRequest({ name: 'Renamed' }, staffHeaders()), ctx);
      const familyWrite = fake.writes.find((w) => w.path === `families/${TARGET_FID}`);
      expect(familyWrite?.data).not.toHaveProperty('locationNeedsConfirmation');
    });
  });
});