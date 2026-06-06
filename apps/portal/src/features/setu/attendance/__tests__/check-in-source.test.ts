import { it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPortal, mockMaster } = vi.hoisted(() => ({
  mockPortal: vi.fn(() => 'PORTAL_FS'),
  mockMaster: vi.fn(() => 'MASTER_FS'),
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: mockPortal,
  masterFirestore: mockMaster,
}));

import { checkInSourceFirestore } from '../check-in-source';

const origPortal = process.env.PORTAL_FIREBASE_PROJECT_ID;
const origMaster = process.env.MASTER_FIREBASE_PROJECT_ID;

beforeEach(() => { mockPortal.mockClear(); mockMaster.mockClear(); });
afterEach(() => {
  process.env.PORTAL_FIREBASE_PROJECT_ID = origPortal;
  process.env.MASTER_FIREBASE_PROJECT_ID = origMaster;
});

it('reads from the MASTER app when portal and master are different projects (portal on UAT)', () => {
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'chinmaya-setu-uat';
  process.env.MASTER_FIREBASE_PROJECT_ID = 'chinmaya-setu-715b8';
  expect(checkInSourceFirestore()).toBe('MASTER_FS');
  expect(mockMaster).toHaveBeenCalledTimes(1);
  expect(mockPortal).not.toHaveBeenCalled();
});

it('reads from the PORTAL app once the portal runs on the same project as the door data', () => {
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'chinmaya-setu-715b8';
  process.env.MASTER_FIREBASE_PROJECT_ID = 'chinmaya-setu-715b8';
  expect(checkInSourceFirestore()).toBe('PORTAL_FS');
  expect(mockPortal).toHaveBeenCalledTimes(1);
  expect(mockMaster).not.toHaveBeenCalled();
});
