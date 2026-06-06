import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: mockCollection })),
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import {
  getVolunteeringSkillOptions,
  setVolunteeringSkillOptions,
  DEFAULT_VOLUNTEERING_SKILLS,
} from '../volunteering-skills';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getVolunteeringSkillOptions', () => {
  it('returns the default seed when the config doc does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await getVolunteeringSkillOptions()).toEqual([...DEFAULT_VOLUNTEERING_SKILLS]);
  });

  it('returns the stored options when the doc exists', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: ['Teaching', 'Music'] }) });
    expect(await getVolunteeringSkillOptions()).toEqual(['Teaching', 'Music']);
  });

  it('honours an empty options array (admins cleared the list)', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: [] }) });
    expect(await getVolunteeringSkillOptions()).toEqual([]);
  });

  it('falls back to defaults when options is not an array', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: 'oops' }) });
    expect(await getVolunteeringSkillOptions()).toEqual([...DEFAULT_VOLUNTEERING_SKILLS]);
  });

  it('drops non-string entries defensively', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: ['Teaching', 7, null, 'AV'] }) });
    expect(await getVolunteeringSkillOptions()).toEqual(['Teaching', 'AV']);
  });
});

describe('setVolunteeringSkillOptions', () => {
  it('writes the options array with a server timestamp', async () => {
    mockSet.mockResolvedValue(undefined);
    await setVolunteeringSkillOptions(['A', 'B']);
    expect(mockSet).toHaveBeenCalledWith({ options: ['A', 'B'], updatedAt: 'SERVER_TS' });
  });
});
