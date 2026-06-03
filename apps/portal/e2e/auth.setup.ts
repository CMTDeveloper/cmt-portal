import { test as setup, expect } from '@playwright/test';
import { E2E_FAMILY_EMAIL, E2E_FAMILY_PASSWORD, hasFamilyCreds } from './_helpers';

const STORAGE = 'e2e/.auth/family.json';

setup('authenticate family via password-sign-in', async ({ request }) => {
  setup.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  const res = await request.post('/api/setu/auth/password-sign-in', {
    data: { email: E2E_FAMILY_EMAIL, password: E2E_FAMILY_PASSWORD },
  });
  expect(res.ok(), `password-sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  // The __session cookie is now in the request context; persist it.
  await request.storageState({ path: STORAGE });
});
