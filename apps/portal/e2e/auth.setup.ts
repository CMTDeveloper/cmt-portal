import { test as setup } from '@playwright/test';
import { hasFamilyCreds } from './_helpers';
import { signInFamilyAndSaveStorage } from './auth-helpers';

setup('authenticate family via password-sign-in', async ({ request }) => {
  setup.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  // Sign in via password-sign-in (never OTP) and persist the __session cookie to
  // the shared storageState file the `setu` project loads. See auth-helpers.ts.
  await signInFamilyAndSaveStorage(request);
});
