import { test, expect } from '@playwright/test';

test.describe('C — events registration', () => {
  test('flag-off: /events/register returns 404', async ({ page }) => {
    test.skip(
      !!process.env.NEXT_PUBLIC_FEATURE_EVENTS_REGISTER,
      'eventsRegister flag is on — 404 test only applies when flag is off',
    );
    const res = await page.goto('/events/register');
    expect(res?.status()).toBe(404);
  });

  test('flag-on: /events/register renders the registration form', async ({ page }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_FEATURE_EVENTS_REGISTER,
      'NEXT_PUBLIC_FEATURE_EVENTS_REGISTER not set — skipping flag-on form render test',
    );
    await page.goto('/events/register');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.locator('form')).toBeVisible();
  });

  test('flag-off: POST /api/events/register returns 404', async ({ page }) => {
    test.skip(
      !!process.env.NEXT_PUBLIC_FEATURE_EVENTS_REGISTER,
      'eventsRegister flag is on',
    );
    const res = await page.request.post('/api/events/register', {
      data: { registrationId: 'MD26-TEST123', name: 'Test', email: 'test@test.com', adults: 1, children: 0, payment_source: 'etransfer', contribution: 10 },
    });
    expect(res.status()).toBe(404);
  });

  test('webhook: POST /api/events/webhooks/payment-status returns 401 without API key', async ({ page }) => {
    const res = await page.request.post('/api/events/webhooks/payment-status', {
      data: { registrationId: 'MD26-ABC1234', paymentStatus: 'completed' },
    });
    expect(res.status()).toBe(401);
  });

  test('webhook: POST /api/events/webhooks/payment-status returns 401 with wrong API key', async ({ page }) => {
    const res = await page.request.post('/api/events/webhooks/payment-status', {
      headers: { 'x-api-key': 'wrong-key-definitely-invalid' },
      data: { registrationId: 'MD26-ABC1234', paymentStatus: 'completed' },
    });
    expect(res.status()).toBe(401);
  });
});
