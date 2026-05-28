// Resolves the CMT Stripe Cloud Run checkout endpoint. When
// STRIPE_USE_TEST_CHECKOUT is "true" and STRIPE_CHECKOUT_URL_TEST is set, the
// test endpoint is used; otherwise falls back to STRIPE_CHECKOUT_URL. The same
// STRIPE_API_KEY (sent as `x-api-key`) is accepted by both endpoints.
//
// Mirrors chinmaya-event-registration/src/lib/stripe-config.ts so the two CMT
// properties share one checkout service + key.
export function getStripeCheckoutUrl(): string | undefined {
  const useTest = process.env.STRIPE_USE_TEST_CHECKOUT === 'true';
  if (useTest && process.env.STRIPE_CHECKOUT_URL_TEST) {
    return process.env.STRIPE_CHECKOUT_URL_TEST;
  }
  return process.env.STRIPE_CHECKOUT_URL;
}
