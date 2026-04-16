# Slice C — Event Registration Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the standalone `chinmaya-event-registration` app into `apps/portal` as internal route segments under `/events/register/*`, with strict functional parity and zero user-facing regressions. Both apps write to the same Firestore collection during a parallel-run soak period. The standalone continues running unchanged. Cutover is purely URL + webhook + Cloud Run allowlist, coordinated manually post-slice.

**Architecture:** Registration is a public flow (no auth). Seven API routes under `/api/events/*` serve JSON to both the portal's React UI and future mobile clients. Shared types and pricing live in `@cmt/shared-domain/events/*` (pure TS, no React). Portal-only components and helpers live in `features/events/*`. BV roster lookup reuses `findFamilyById`/`findFamilyByContact` from `features/check-in/shared/rtdb/family-lookup.ts` via internal import (same app, no cross-feature-directory violation because the helpers are re-exported through `features/check-in/shared/index.ts` and events only imports the lookup functions, not check-in UI). Firestore rate limiter follows the B2 pattern from `otp-rate-limit.ts`.

**Tech Stack:** Next.js 16 (App Router), Zod for API validation, `@cmt/firebase-shared/admin` for Firestore + RTDB, `@cmt/ui` for ErrorFallback. No new npm dependencies. No `react-datepicker`, `react-hot-toast`, `react-phone-number-input`, `xlsx`, `redis`, `@headlessui`, or webpack Node module fallbacks.

**Spec:** `docs/superpowers/specs/2026-04-15-slice-c-event-registration-port-design.md`

**Standalone source:** `/Users/dineshmatta/projects/chinmaya-event-registration/` (reference only, do not modify)

---

## Pre-flight notes

**Working directory:** `/Users/dineshmatta/projects/chinmaya-mission-portal`

**Prerequisites:** Slice B shipped (B0 + B2 + B3 + B1 + B4 + B5). Verify:

```sh
test -f apps/portal/src/features/check-in/shared/rtdb/family-lookup.ts && \
test -f packages/firebase-shared/src/admin/firestore.ts && \
test -f apps/portal/src/features/check-in/shared/rate-limit/otp-rate-limit.ts && \
echo "Prerequisites present" || echo "MISSING prerequisite"
```

**Branch model:** solo-dev main-only. Final task pushes.

**Feature flag during execution:** `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=true` in `.env.local` locally for development. `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=false` in Vercel Production until soak is approved.

---

## File structure overview

```
chinmaya-mission-portal/
├── packages/shared-domain/src/events/                      [Task 1]
│   ├── registration.ts
│   ├── pricing.ts
│   ├── api-contracts.ts
│   ├── index.ts
│   └── __tests__/
│       ├── pricing.test.ts
│       └── api-contracts.test.ts
│
├── packages/shared-domain/src/index.ts                     [Task 1, MODIFIED]
│
├── apps/portal/src/lib/flags.ts                            [Task 2, MODIFIED]
├── apps/portal/src/lib/env.ts                              [Task 2, MODIFIED]
├── apps/portal/.env.local                                  [Task 2, MODIFIED]
│
├── apps/portal/src/features/events/                        [Tasks 3, 11-14]
│   ├── shared/
│   │   ├── bv-contacts.ts                                  [Task 3]
│   │   ├── firestore-adapter.ts                            [Task 3]
│   │   ├── google-sheets-sender.ts                         [Task 3]
│   │   ├── rate-limiter.ts                                 [Task 3]
│   │   └── __tests__/
│   │       ├── bv-contacts.test.ts                         [Task 3]
│   │       ├── firestore-adapter.test.ts                   [Task 3]
│   │       └── google-sheets-sender.test.ts                [Task 3]
│   ├── counter-input.tsx                                   [Task 11]
│   ├── step-indicator.tsx                                  [Task 11]
│   ├── order-summary.tsx                                   [Task 11]
│   ├── success-banner.tsx                                  [Task 11]
│   ├── cancel-banner.tsx                                   [Task 11]
│   ├── registration-form.tsx                               [Task 12]
│   ├── registration-form-shell.tsx                         [Task 12]
│   ├── payment-instructions.tsx                            [Task 13]
│   ├── index.ts                                            [Task 11, MODIFIED each]
│   └── __tests__/
│       ├── counter-input.test.tsx                          [Task 11]
│       ├── step-indicator.test.tsx                         [Task 11]
│       ├── order-summary.test.tsx                          [Task 11]
│       ├── success-banner.test.tsx                         [Task 11]
│       └── cancel-banner.test.tsx                          [Task 11]
│
├── apps/portal/src/app/api/events/                         [Tasks 4-10]
│   ├── check-bv-status/
│   │   ├── route.ts                                        [Task 4]
│   │   └── __tests__/route.test.ts                         [Task 4]
│   ├── register/
│   │   ├── route.ts                                        [Task 5]
│   │   └── __tests__/route.test.ts                         [Task 5]
│   ├── lookup/
│   │   ├── route.ts                                        [Task 6]
│   │   └── __tests__/route.test.ts                         [Task 6]
│   ├── create-checkout/
│   │   ├── route.ts                                        [Task 7]
│   │   └── __tests__/route.test.ts                         [Task 7]
│   ├── update-reference/
│   │   ├── route.ts                                        [Task 8]
│   │   └── __tests__/route.test.ts                         [Task 8]
│   ├── update-payment-status/
│   │   ├── route.ts                                        [Task 9]
│   │   └── __tests__/route.test.ts                         [Task 9]
│   └── webhooks/payment-status/
│       ├── route.ts                                        [Task 10]
│       └── __tests__/route.test.ts                         [Task 10]
│
├── apps/portal/src/app/events/register/                    [Tasks 12-14]
│   ├── page.tsx                                            [Task 12]
│   ├── error.tsx                                           [Task 12]
│   ├── loading.tsx                                         [Task 12]
│   ├── payment/
│   │   ├── page.tsx                                        [Task 13]
│   │   └── error.tsx                                       [Task 13]
│   ├── success/
│   │   ├── page.tsx                                        [Task 14]
│   │   └── error.tsx                                       [Task 14]
│   └── cancel/
│       ├── page.tsx                                        [Task 14]
│       └── error.tsx                                       [Task 14]
│
├── apps/portal/e2e/c-events.spec.ts                        [Task 16]
├── README.md                                               [Task 16, MODIFIED]
└── CLAUDE.md                                               [Task 16, MODIFIED]
```

**Task count:** 16. **Final task pushes.**

---

## Task 1: `@cmt/shared-domain/events` — types, pricing, API contracts

**Files:**
- Create: `packages/shared-domain/src/events/registration.ts`
- Create: `packages/shared-domain/src/events/pricing.ts`
- Create: `packages/shared-domain/src/events/api-contracts.ts`
- Create: `packages/shared-domain/src/events/index.ts`
- Modify: `packages/shared-domain/src/index.ts` (add barrel export)
- Test: `packages/shared-domain/src/events/__tests__/pricing.test.ts`
- Test: `packages/shared-domain/src/events/__tests__/api-contracts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared-domain/src/events/__tests__/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { calculatePricing } from '../pricing';

describe('calculatePricing', () => {
  // --- Non-BV pricing ($10 per person) ---

  it('calculates Non-BV etransfer: 1 adult, 0 children', () => {
    const result = calculatePricing({
      adults: 1,
      children: 0,
      isBvFamily: false,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(10);
  });

  it('calculates Non-BV etransfer: 2 adults, 1 child', () => {
    const result = calculatePricing({
      adults: 2,
      children: 1,
      isBvFamily: false,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(30);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(30);
  });

  it('calculates Non-BV stripe: 2 adults, 1 child with processing fee', () => {
    const result = calculatePricing({
      adults: 2,
      children: 1,
      isBvFamily: false,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(30);
    expect(result.processingFee).toBe(0.96);
    expect(result.total).toBe(30.96);
  });

  it('calculates Non-BV stripe: 1 adult, 0 children with processing fee', () => {
    const result = calculatePricing({
      adults: 1,
      children: 0,
      isBvFamily: false,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0.52);
    expect(result.total).toBe(10.52);
  });

  it('calculates Non-BV etransfer: 5 adults, 5 children', () => {
    const result = calculatePricing({
      adults: 5,
      children: 5,
      isBvFamily: false,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(100);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(100);
  });

  // --- BV Family pricing ($10 flat) ---

  it('calculates BV Family flat rate regardless of attendee count', () => {
    const result = calculatePricing({
      adults: 2,
      children: 3,
      isBvFamily: true,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(10);
  });

  it('calculates BV Family stripe with processing fee on $10', () => {
    const result = calculatePricing({
      adults: 2,
      children: 3,
      isBvFamily: true,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0.52);
    expect(result.total).toBe(10.52);
  });

  it('BV Family flat rate is same for 1 person or 10 people', () => {
    const one = calculatePricing({
      adults: 1,
      children: 0,
      isBvFamily: true,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    const ten = calculatePricing({
      adults: 5,
      children: 5,
      isBvFamily: true,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(one.subtotal).toBe(ten.subtotal);
    expect(one.total).toBe(ten.total);
  });

  // --- Custom price per person ---

  it('uses custom pricePerPerson for non-BV', () => {
    const result = calculatePricing({
      adults: 2,
      children: 0,
      isBvFamily: false,
      paymentMethod: 'etransfer',
      pricePerPerson: 25,
    });
    expect(result.subtotal).toBe(50);
    expect(result.total).toBe(50);
  });

  it('BV flat rate equals pricePerPerson regardless of attendee count', () => {
    const result = calculatePricing({
      adults: 4,
      children: 2,
      isBvFamily: true,
      paymentMethod: 'etransfer',
      pricePerPerson: 25,
    });
    expect(result.subtotal).toBe(25);
    expect(result.total).toBe(25);
  });

  // --- Edge cases ---

  it('returns 0 total for 0 adults, 0 children, non-BV', () => {
    const result = calculatePricing({
      adults: 0,
      children: 0,
      isBvFamily: false,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
  });

  it('stripe fee on $0 is just the fixed fee', () => {
    const result = calculatePricing({
      adults: 0,
      children: 0,
      isBvFamily: false,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(0);
    expect(result.processingFee).toBe(0.3);
    expect(result.total).toBe(0.3);
  });
});
```

```ts
// packages/shared-domain/src/events/__tests__/api-contracts.test.ts
import { describe, it, expect } from 'vitest';
import {
  checkBvStatusRequestSchema,
  registerRequestSchema,
  lookupRequestSchema,
  createCheckoutRequestSchema,
  updateReferenceRequestSchema,
  updatePaymentStatusRequestSchema,
  webhookPaymentStatusRequestSchema,
} from '../api-contracts';

describe('checkBvStatusRequestSchema', () => {
  it('accepts email variant', () => {
    const result = checkBvStatusRequestSchema.safeParse({ email: 'a@b.com' });
    expect(result.success).toBe(true);
  });

  it('accepts familyId variant', () => {
    const result = checkBvStatusRequestSchema.safeParse({ familyId: '42' });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = checkBvStatusRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = checkBvStatusRequestSchema.safeParse({ email: 'not-email' });
    expect(result.success).toBe(false);
  });
});

describe('registerRequestSchema', () => {
  const valid = {
    registrationId: 'MD26-ABC1234',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '416-555-0000',
    adults: 2,
    children: 1,
    payment_source: 'etransfer',
    contribution: 15,
  };

  it('accepts valid payload', () => {
    expect(registerRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid registrationId format', () => {
    expect(registerRequestSchema.safeParse({ ...valid, registrationId: 'abc' }).success).toBe(false);
  });

  it('rejects adults below 1', () => {
    expect(registerRequestSchema.safeParse({ ...valid, adults: 0 }).success).toBe(false);
  });

  it('rejects adults above 50', () => {
    expect(registerRequestSchema.safeParse({ ...valid, adults: 51 }).success).toBe(false);
  });

  it('accepts optional isBvFamily', () => {
    expect(registerRequestSchema.safeParse({ ...valid, isBvFamily: true }).success).toBe(true);
  });

  it('accepts optional etransferReference within 50 chars', () => {
    expect(registerRequestSchema.safeParse({ ...valid, etransferReference: 'C1AsjcyW6gqU' }).success).toBe(true);
  });

  it('rejects etransferReference over 50 chars', () => {
    expect(registerRequestSchema.safeParse({ ...valid, etransferReference: 'A'.repeat(51) }).success).toBe(false);
  });
});

describe('lookupRequestSchema', () => {
  it('accepts valid payload', () => {
    expect(lookupRequestSchema.safeParse({ registrationId: 'MD26-ABC1234', email: 'a@b.com' }).success).toBe(true);
  });

  it('rejects missing email', () => {
    expect(lookupRequestSchema.safeParse({ registrationId: 'MD26-ABC1234' }).success).toBe(false);
  });
});

describe('createCheckoutRequestSchema', () => {
  const valid = {
    lineItems: [{ name: 'Adults', amount: 10.0, quantity: 2 }, { name: 'Processing Fees', amount: 0.74, quantity: 1 }],
    customerEmail: 'test@example.com',
    client_reference_id: 'MD26-ABC1234',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  };

  it('accepts valid payload', () => {
    expect(createCheckoutRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects empty lineItems', () => {
    expect(createCheckoutRequestSchema.safeParse({ ...valid, lineItems: [] }).success).toBe(false);
  });

  it('rejects invalid line item name', () => {
    expect(createCheckoutRequestSchema.safeParse({
      ...valid,
      lineItems: [{ name: 'Hacked', amount: 10, quantity: 1 }],
    }).success).toBe(false);
  });
});

describe('updateReferenceRequestSchema', () => {
  it('accepts valid payload', () => {
    expect(updateReferenceRequestSchema.safeParse({
      registrationId: 'MD26-ABC1234',
      email: 'a@b.com',
      etransferReference: 'C1Asj',
    }).success).toBe(true);
  });

  it('rejects missing etransferReference', () => {
    expect(updateReferenceRequestSchema.safeParse({
      registrationId: 'MD26-ABC1234',
      email: 'a@b.com',
    }).success).toBe(false);
  });
});

describe('updatePaymentStatusRequestSchema', () => {
  it('accepts completed + stripe', () => {
    expect(updatePaymentStatusRequestSchema.safeParse({
      registrationId: 'MD26-ABC1234',
      paymentStatus: 'completed',
      payment_source: 'stripe',
    }).success).toBe(true);
  });

  it('rejects non-completed paymentStatus', () => {
    expect(updatePaymentStatusRequestSchema.safeParse({
      registrationId: 'MD26-ABC1234',
      paymentStatus: 'pending',
      payment_source: 'stripe',
    }).success).toBe(false);
  });

  it('rejects non-stripe payment_source', () => {
    expect(updatePaymentStatusRequestSchema.safeParse({
      registrationId: 'MD26-ABC1234',
      paymentStatus: 'completed',
      payment_source: 'etransfer',
    }).success).toBe(false);
  });
});

describe('webhookPaymentStatusRequestSchema', () => {
  it('accepts all valid statuses', () => {
    for (const status of ['pending', 'completed', 'failed', 'refunded']) {
      expect(webhookPaymentStatusRequestSchema.safeParse({
        registrationId: 'MD26-ABC1234',
        paymentStatus: status,
      }).success).toBe(true);
    }
  });

  it('defaults payment_source to unknown', () => {
    const result = webhookPaymentStatusRequestSchema.parse({
      registrationId: 'MD26-ABC1234',
      paymentStatus: 'completed',
    });
    expect(result.payment_source).toBe('unknown');
  });

  it('rejects invalid paymentStatus', () => {
    expect(webhookPaymentStatusRequestSchema.safeParse({
      registrationId: 'MD26-ABC1234',
      paymentStatus: 'hacked',
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```sh
pnpm --filter @cmt/shared-domain test -- src/events/__tests__/pricing.test.ts
pnpm --filter @cmt/shared-domain test -- src/events/__tests__/api-contracts.test.ts
```

- [ ] **Step 3: Create `packages/shared-domain/src/events/registration.ts`**

```ts
export const PAYMENT_SOURCES = ['etransfer', 'stripe'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const REGISTRATION_PAYMENT_STATUSES = [
  'pending',
  'completed',
  'failed',
  'refunded',
  'cancelled',
] as const;
export type RegistrationPaymentStatus =
  (typeof REGISTRATION_PAYMENT_STATUSES)[number];

export interface EventRegistration {
  registrationId: string;
  campaign: string;
  name: string;
  email: string;
  phone: string;
  adults: number;
  children: number;
  isBvFamily: boolean;
  payment_source: PaymentSource;
  contribution: number;
  etransferReference?: string;
  paymentStatus: RegistrationPaymentStatus;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: Create `packages/shared-domain/src/events/pricing.ts`**

```ts
import type { PaymentSource } from './registration';

const BV_FAMILY_FLAT_PRICE = 10.0;
const STRIPE_PERCENT_FEE = 0.022;
const STRIPE_FIXED_FEE = 0.3;

export interface PricingInput {
  adults: number;
  children: number;
  isBvFamily: boolean;
  paymentMethod: PaymentSource;
  pricePerPerson: number;
}

export interface PricingResult {
  subtotal: number;
  processingFee: number;
  total: number;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const subtotal = input.isBvFamily
    ? BV_FAMILY_FLAT_PRICE
    : (input.adults + input.children) * input.pricePerPerson;

  const processingFee =
    input.paymentMethod === 'stripe'
      ? Math.round((subtotal * STRIPE_PERCENT_FEE + STRIPE_FIXED_FEE) * 100) / 100
      : 0;

  const total = Math.round((subtotal + processingFee) * 100) / 100;

  return { subtotal, processingFee, total };
}
```

- [ ] **Step 5: Create `packages/shared-domain/src/events/api-contracts.ts`**

```ts
import { z } from 'zod';

// --- check-bv-status ---

export const checkBvStatusRequestSchema = z.union([
  z.object({ familyId: z.string().min(1).max(10) }),
  z.object({ email: z.string().email() }),
]);
export type CheckBvStatusRequest = z.infer<typeof checkBvStatusRequestSchema>;

export const checkBvStatusResponseSchema = z.object({
  isBvFamily: z.boolean(),
  familyEmails: z.array(z.string()).optional(),
  familyPhones: z.array(z.string()).optional(),
});
export type CheckBvStatusResponse = z.infer<typeof checkBvStatusResponseSchema>;

// --- register ---

export const registerRequestSchema = z.object({
  registrationId: z.string().regex(/^MD26-[A-Z0-9]{7}$/),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  adults: z.number().int().min(1).max(50),
  children: z.number().int().min(0).max(50),
  payment_source: z.enum(['stripe', 'etransfer']),
  contribution: z.number().min(0),
  isBvFamily: z.boolean().optional(),
  etransferReference: z.string().max(50).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// --- lookup ---

export const lookupRequestSchema = z.object({
  registrationId: z.string().min(1).max(20),
  email: z.string().email(),
});
export type LookupRequest = z.infer<typeof lookupRequestSchema>;

// --- create-checkout ---

export const lineItemSchema = z.object({
  name: z.enum(['Adults', 'Child', 'BV Family', 'Processing Fees']),
  amount: z.number().positive().max(1000),
  quantity: z.number().int().positive().max(100),
});

export const createCheckoutRequestSchema = z.object({
  lineItems: z.array(lineItemSchema).min(1).max(5),
  customerEmail: z.string().email(),
  client_reference_id: z.string().regex(/^MD26-[A-Z0-9]{7}$/),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  metadata: z.object({ campaign: z.string() }).optional(),
  branding_settings: z.object({ display_name: z.string() }).optional(),
});
export type CreateCheckoutRequest = z.infer<typeof createCheckoutRequestSchema>;

// --- update-reference ---

export const updateReferenceRequestSchema = z.object({
  registrationId: z.string().regex(/^MD26-[A-Z0-9]{7}$/),
  email: z.string().email(),
  etransferReference: z.string().min(1).max(50),
});
export type UpdateReferenceRequest = z.infer<typeof updateReferenceRequestSchema>;

// --- update-payment-status (client-side, Stripe success page) ---

export const updatePaymentStatusRequestSchema = z.object({
  registrationId: z.string().regex(/^MD26-[A-Z0-9]{7}$/),
  paymentStatus: z.enum(['completed']),
  payment_source: z.enum(['stripe']),
});
export type UpdatePaymentStatusRequest = z.infer<typeof updatePaymentStatusRequestSchema>;

// --- webhook payment-status (server-side, Vaibhav's admin tool) ---

export const webhookPaymentStatusRequestSchema = z.object({
  registrationId: z.string().regex(/^MD26-[A-Z0-9]{7}$/),
  paymentStatus: z.enum(['pending', 'completed', 'failed', 'refunded']),
  payment_source: z.enum(['stripe', 'etransfer', 'unknown']).optional().default('unknown'),
});
export type WebhookPaymentStatusRequest = z.infer<typeof webhookPaymentStatusRequestSchema>;
```

- [ ] **Step 6: Create `packages/shared-domain/src/events/index.ts`**

```ts
export * from './registration';
export * from './pricing';
export * from './api-contracts';
```

- [ ] **Step 7: Modify `packages/shared-domain/src/index.ts` — add events barrel**

Add to the existing barrel:

```ts
export * from './events';
```

The file should now read:

```ts
export * from './auth';
export * from './check-in';
export * from './events';
```

- [ ] **Step 8: Run tests — expect pass**

```sh
pnpm --filter @cmt/shared-domain test -- src/events/__tests__/pricing.test.ts
pnpm --filter @cmt/shared-domain test -- src/events/__tests__/api-contracts.test.ts
```

- [ ] **Step 9: Commit**

```sh
git add packages/shared-domain/src/events/ packages/shared-domain/src/index.ts
git commit -m "feat(shared-domain): add events types, calculatePricing, and API contract Zod schemas"
```

---

## Task 2: Feature flag + env schema + `.env.local`

**Files:**
- Modify: `apps/portal/src/lib/flags.ts`
- Modify: `apps/portal/src/lib/env.ts`
- Modify: `apps/portal/.env.local`

- [ ] **Step 1: Modify `apps/portal/src/lib/flags.ts`**

The `events` flag already exists. Replace it with `eventsRegister` for granular control:

```ts
function readFlag(name: string): boolean {
  return process.env[name] === 'true';
}

const master = readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN');

export const flags = {
  events: readFlag('NEXT_PUBLIC_FEATURE_EVENTS'),
  eventsRegister: readFlag('NEXT_PUBLIC_FEATURE_EVENTS_REGISTER'),
  checkIn: master,
  checkInKiosk: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK'),
  checkInFamily: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY'),
  checkInTeacher: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER'),
  checkInAdmin: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN'),
  checkInNotify: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY'),
} as const;

export type FeatureFlags = typeof flags;
```

- [ ] **Step 2: Modify `apps/portal/src/lib/env.ts`**

Add the following fields to `portalEnvSchema` (inside the `z.object({...})`), after the existing feature flags block:

```ts
  // Feature flags — events
  NEXT_PUBLIC_FEATURE_EVENTS: flagString,
  NEXT_PUBLIC_FEATURE_EVENTS_REGISTER: flagString,

  // Events — public
  NEXT_PUBLIC_EVENT_CAMPAIGN: z.string().default('2026MothersDay'),
  NEXT_PUBLIC_EVENT_DISPLAY_NAME: z.string().optional(),
  NEXT_PUBLIC_PRICE_PER_PERSON: z.coerce.number().int().min(1).default(10),
  NEXT_PUBLIC_ENABLE_STRIPE: flagString,
  NEXT_PUBLIC_EVENT_POSTER_URL: z.string().url().optional(),
  NEXT_PUBLIC_ETRANSFER_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_GOOGLE_SHEET_URL: z.string().url().optional(),

  // Events — server-only
  STRIPE_CHECKOUT_URL: z.string().url().optional(),
  STRIPE_API_KEY: z.string().min(1).optional(),
  WEBHOOK_API_KEY: z.string().min(1).optional(),
  EVENT_REGISTRATION_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(5),
```

- [ ] **Step 3: Modify `apps/portal/.env.local`**

Add these lines at the end of the file (copy actual secret values from the standalone `.env.local` at `/Users/dineshmatta/projects/chinmaya-event-registration/.env.local`):

```env
# --- Slice C: Event Registration ---
NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=true
NEXT_PUBLIC_EVENT_CAMPAIGN=2026MothersDay
NEXT_PUBLIC_EVENT_DISPLAY_NAME=Mother's Day 2026
NEXT_PUBLIC_PRICE_PER_PERSON=10
NEXT_PUBLIC_ENABLE_STRIPE=false
NEXT_PUBLIC_EVENT_POSTER_URL=<copy from standalone .env.local>
NEXT_PUBLIC_ETRANSFER_EMAIL=<copy from standalone .env.local>
NEXT_PUBLIC_GOOGLE_SHEET_URL=<copy from standalone .env.local>
STRIPE_CHECKOUT_URL=<copy from standalone .env.local>
STRIPE_API_KEY=<copy from standalone .env.local>
WEBHOOK_API_KEY=<copy from standalone .env.local>
EVENT_REGISTRATION_RATE_LIMIT_PER_MIN=5
```

- [ ] **Step 4: Verify env schema parses**

```sh
cd apps/portal && npx tsx -e "const { portalEnvSchema } = require('./src/lib/env'); const r = portalEnvSchema.safeParse(process.env); if(!r.success) { console.error(r.error.issues); process.exit(1); } console.log('OK');"
```

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/lib/flags.ts apps/portal/src/lib/env.ts
git commit -m "feat(portal): add eventsRegister flag + event env vars to env schema"
```

Note: `.env.local` is gitignored, so it is not committed.

---

## Task 3: `features/events/shared/` helpers — bv-contacts, firestore-adapter, google-sheets-sender, rate-limiter

**Files:**
- Create: `apps/portal/src/features/events/shared/bv-contacts.ts`
- Create: `apps/portal/src/features/events/shared/firestore-adapter.ts`
- Create: `apps/portal/src/features/events/shared/google-sheets-sender.ts`
- Create: `apps/portal/src/features/events/shared/rate-limiter.ts`
- Test: `apps/portal/src/features/events/shared/__tests__/bv-contacts.test.ts`
- Test: `apps/portal/src/features/events/shared/__tests__/firestore-adapter.test.ts`
- Test: `apps/portal/src/features/events/shared/__tests__/google-sheets-sender.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/portal/src/features/events/shared/__tests__/bv-contacts.test.ts
import { describe, it, expect } from 'vitest';
import {
  collectFamilyContactSet,
  normalizePhone,
  validateBvContact,
} from '../bv-contacts';

describe('normalizePhone', () => {
  it('normalizes +14379712609 to 4379712609', () => {
    expect(normalizePhone('+14379712609')).toBe('4379712609');
  });

  it('normalizes 14379712609 to 4379712609', () => {
    expect(normalizePhone('14379712609')).toBe('4379712609');
  });

  it('keeps 4379712609 as-is (10 digits, no country code)', () => {
    expect(normalizePhone('4379712609')).toBe('4379712609');
  });

  it('normalizes (437) 971-2609 to 4379712609', () => {
    expect(normalizePhone('(437) 971-2609')).toBe('4379712609');
  });

  it('normalizes +1 (437) 971-2609 to 4379712609', () => {
    expect(normalizePhone('+1 (437) 971-2609')).toBe('4379712609');
  });

  it('does NOT strip leading 1 from 10-digit number starting with 1', () => {
    expect(normalizePhone('1234567890')).toBe('1234567890');
  });

  it('strips leading 1 from 11-digit number', () => {
    expect(normalizePhone('14165551234')).toBe('4165551234');
  });
});

describe('collectFamilyContactSet', () => {
  it('collects emails and phones from roster entries', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, email: 'parent@example.com', phphone: '4165551234', grade: 99 },
      '2': { fid: 42, pemail: 'other@example.com', pmphone: 6475559999, grade: 99 },
      '3': { fid: 42, fname: 'Child', grade: 5 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.emails).toContain('parent@example.com');
    expect(result.emails).toContain('other@example.com');
    expect(result.phones).toContain('4165551234');
    expect(result.phones).toContain('6475559999');
  });

  it('filters out NULL and empty values', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, email: 'NULL', phphone: '', grade: 99 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.emails).toEqual([]);
    expect(result.phones).toEqual([]);
  });

  it('skips entries with different fid', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, email: 'mine@example.com', grade: 99 },
      '2': { fid: 99, email: 'other@example.com', grade: 99 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.emails).toEqual(['mine@example.com']);
  });

  it('lowercases and trims emails', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, email: ' Parent@Example.COM ', grade: 99 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.emails).toEqual(['parent@example.com']);
  });

  it('normalizes phones (strips leading 1 from 11-digit)', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, phphone: '14165551234', grade: 99 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.phones).toEqual(['4165551234']);
  });

  it('handles numeric phone values from RTDB', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, phphone: 4165551234, grade: 99 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.phones).toContain('4165551234');
  });

  it('filters phones shorter than 7 digits', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, phphone: '123', grade: 99 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.phones).toEqual([]);
  });

  it('deduplicates emails and phones', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, email: 'parent@example.com', pemail: 'parent@example.com', phphone: '4165551234', pmphone: '4165551234', grade: 99 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.emails).toHaveLength(1);
    expect(result.phones).toHaveLength(1);
  });

  it('collects emergency contact fields', () => {
    const roster: Record<string, Record<string, unknown>> = {
      '1': { fid: 42, emergency_email: 'emerg@example.com', emergency_hphone: '9055551111', emergency_mphone: '9055552222', grade: 99 },
    };
    const result = collectFamilyContactSet(roster, 42);
    expect(result.emails).toContain('emerg@example.com');
    expect(result.phones).toContain('9055551111');
    expect(result.phones).toContain('9055552222');
  });
});

describe('validateBvContact', () => {
  it('passes when email matches but phone does not', () => {
    expect(validateBvContact(
      'parent@example.com', '+19999999999',
      ['parent@example.com'], ['4165551234'],
    )).toBe(true);
  });

  it('passes when phone matches but email does not', () => {
    expect(validateBvContact(
      'wrong@example.com', '+14165551234',
      ['parent@example.com'], ['4165551234'],
    )).toBe(true);
  });

  it('passes when both email and phone match', () => {
    expect(validateBvContact(
      'parent@example.com', '+14165551234',
      ['parent@example.com'], ['4165551234'],
    )).toBe(true);
  });

  it('fails when neither email nor phone match', () => {
    expect(validateBvContact(
      'wrong@example.com', '+19999999999',
      ['parent@example.com'], ['4165551234'],
    )).toBe(false);
  });

  it('matches phone with +1 country code against 10-digit roster number', () => {
    expect(validateBvContact(
      'wrong@example.com', '+14379712609',
      ['parent@example.com'], ['4379712609'],
    )).toBe(true);
  });

  it('matches phone without country code against roster number', () => {
    expect(validateBvContact(
      'wrong@example.com', '4379712609',
      ['parent@example.com'], ['4379712609'],
    )).toBe(true);
  });

  it('matches phone with formatting (437) 971-2609', () => {
    expect(validateBvContact(
      'wrong@example.com', '(437) 971-2609',
      ['parent@example.com'], ['4379712609'],
    )).toBe(true);
  });

  it('passes when roster has only emails and email matches', () => {
    expect(validateBvContact(
      'parent@example.com', '+14379712609',
      ['parent@example.com'], [],
    )).toBe(true);
  });

  it('fails when roster has only emails and email does not match', () => {
    expect(validateBvContact(
      'wrong@example.com', '+14379712609',
      ['parent@example.com'], [],
    )).toBe(false);
  });

  it('passes when roster has only phones and phone matches', () => {
    expect(validateBvContact(
      'wrong@example.com', '+14379712609',
      [], ['4379712609'],
    )).toBe(true);
  });

  it('fails when roster has only phones and phone does not match', () => {
    expect(validateBvContact(
      'wrong@example.com', '+19999999999',
      [], ['4379712609'],
    )).toBe(false);
  });

  it('passes when roster has no emails and no phones', () => {
    expect(validateBvContact(
      'anyone@example.com', '+14379712609',
      [], [],
    )).toBe(true);
  });

  it('email matching is case insensitive', () => {
    expect(validateBvContact(
      'PARENT@EXAMPLE.COM', '+19999999999',
      ['parent@example.com'], ['4165551234'],
    )).toBe(true);
  });
});
```

```ts
// apps/portal/src/features/events/shared/__tests__/firestore-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDoc = vi.fn();
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: mockCollection,
      })),
    })),
  })),
}));

import { registrationsCollection } from '../firestore-adapter';

describe('registrationsCollection', () => {
  it('returns a collection reference for the given campaign', () => {
    const coll = registrationsCollection('2026MothersDay');
    expect(coll).toBeDefined();
    expect(coll.doc).toBeDefined();
  });
});
```

```ts
// apps/portal/src/features/events/shared/__tests__/google-sheets-sender.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendToGoogleSheet } from '../google-sheets-sender';

describe('sendToGoogleSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs payload to the Google Sheet URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
    await sendToGoogleSheet('https://script.google.com/test', { registrationId: 'MD26-ABC1234' });
    expect(fetch).toHaveBeenCalledWith(
      'https://script.google.com/test',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('MD26-ABC1234'),
      }),
    );
  });

  it('swallows errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    await expect(sendToGoogleSheet('https://script.google.com/test', { id: '1' })).resolves.toBeUndefined();
  });

  it('does nothing when url is empty', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await sendToGoogleSheet('', { id: '1' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/features/events/shared/__tests__/bv-contacts.test.ts
pnpm --filter @cmt/portal test -- src/features/events/shared/__tests__/firestore-adapter.test.ts
pnpm --filter @cmt/portal test -- src/features/events/shared/__tests__/google-sheets-sender.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/features/events/shared/bv-contacts.ts`**

```ts
/**
 * BV roster contact collection and validation helpers.
 * Ported from standalone chinmaya-event-registration/src/lib/firebase-admin.ts.
 */

export interface FamilyContactSet {
  emails: string[];
  phones: string[];
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1);
  }
  return digits;
}

export function collectFamilyContactSet(
  roster: Record<string, Record<string, unknown>>,
  fid: number,
): FamilyContactSet {
  const emails = new Set<string>();
  const phones = new Set<string>();

  for (const key of Object.keys(roster)) {
    const entry = roster[key];
    if (!entry || entry.fid !== fid) continue;

    for (const field of [entry.email, entry.pemail, entry.emergency_email]) {
      if (field && typeof field === 'string' && field !== 'NULL') {
        emails.add(field.toLowerCase().trim());
      }
    }

    for (const field of [
      entry.phone,
      entry.phphone,
      entry.pmphone,
      entry.emergency_hphone,
      entry.emergency_mphone,
    ]) {
      if (field === null || field === undefined || field === 'NULL') continue;
      const asString = String(field);
      const normalized = normalizePhone(asString);
      if (normalized.length >= 7) phones.add(normalized);
    }
  }

  return { emails: [...emails], phones: [...phones] };
}

export function validateBvContact(
  email: string,
  phone: string,
  familyEmails: string[],
  familyPhones: string[],
): boolean {
  const canCheckEmail = familyEmails.length > 0;
  const canCheckPhone = familyPhones.length > 0;
  if (!canCheckEmail && !canCheckPhone) return true;
  const emailMatch =
    canCheckEmail && familyEmails.includes(email.toLowerCase().trim());
  const phoneMatch =
    canCheckPhone && familyPhones.includes(normalizePhone(phone));
  return emailMatch || phoneMatch;
}
```

- [ ] **Step 4: Create `apps/portal/src/features/events/shared/firestore-adapter.ts`**

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type {
  CollectionReference,
  DocumentData,
} from 'firebase-admin/firestore';

/**
 * Returns the Firestore registrations subcollection for the given event campaign.
 * Path: events/{campaign}/registrations
 */
export function registrationsCollection(
  campaign?: string,
): CollectionReference<DocumentData> {
  const c = campaign || process.env.NEXT_PUBLIC_EVENT_CAMPAIGN || '2026MothersDay';
  return portalFirestore()
    .collection('events')
    .doc(c)
    .collection('registrations');
}
```

- [ ] **Step 5: Create `apps/portal/src/features/events/shared/google-sheets-sender.ts`**

```ts
/**
 * Fire-and-forget helper to POST payload to the Google Apps Script endpoint.
 * Failures are logged but never thrown — Google Sheet is a backup, not primary.
 */
export async function sendToGoogleSheet(
  url: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(
      'Google Sheet write failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
```

- [ ] **Step 6: Create `apps/portal/src/features/events/shared/rate-limiter.ts`**

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const DEFAULT_MAX = 5;
const WINDOW_MS = 60_000; // 1 minute

export interface RateLimitResult {
  allowed: boolean;
}

/**
 * Firestore-backed IP rate limiter.
 * Uses the same transactional pattern as otp-rate-limit.ts from slice B2.
 */
export async function checkIpRateLimit(
  ip: string,
  maxPerMinute?: number,
): Promise<RateLimitResult> {
  const max = maxPerMinute ?? DEFAULT_MAX;
  const ref = portalFirestore().collection('event_rate_limit').doc(ip);

  return portalFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();

    if (!snap.exists) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    const data = snap.data() as
      | { count: number; windowStart: number }
      | undefined;
    if (!data) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (now - data.windowStart >= WINDOW_MS) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (data.count >= max) {
      return { allowed: false };
    }

    tx.set(ref, { count: data.count + 1, windowStart: data.windowStart });
    return { allowed: true };
  });
}
```

- [ ] **Step 7: Run tests — expect pass**

```sh
pnpm --filter @cmt/portal test -- src/features/events/shared/__tests__/bv-contacts.test.ts
pnpm --filter @cmt/portal test -- src/features/events/shared/__tests__/firestore-adapter.test.ts
pnpm --filter @cmt/portal test -- src/features/events/shared/__tests__/google-sheets-sender.test.ts
```

- [ ] **Step 8: Commit**

```sh
git add apps/portal/src/features/events/shared/
git commit -m "feat(portal): events shared helpers — bv-contacts, firestore-adapter, google-sheets-sender, rate-limiter"
```

---

## Task 4: `POST /api/events/check-bv-status` route + test

**Files:**
- Create: `apps/portal/src/app/api/events/check-bv-status/route.ts`
- Test: `apps/portal/src/app/api/events/check-bv-status/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/events/check-bv-status/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

// Mock flags
vi.mock('@/lib/flags', () => ({
  flags: { eventsRegister: true },
}));

// Mock rate limiter
vi.mock('@/features/events/shared/rate-limiter', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Mock family lookup
const mockFindFamilyById = vi.fn();
const mockFindFamilyByContact = vi.fn();
vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: (...args: unknown[]) => mockFindFamilyById(...args),
  findFamilyByContact: (...args: unknown[]) => mockFindFamilyByContact(...args),
}));

// Mock RTDB read for collectFamilyContactSet
vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn().mockResolvedValue(null),
  masterRtdb: vi.fn(() => ({
    ref: vi.fn(() => ({
      once: vi.fn().mockResolvedValue({ val: () => null }),
    })),
  })),
}));

import * as appHandler from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/events/check-bv-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/events/check-bv-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFamilyById.mockResolvedValue(null);
    mockFindFamilyByContact.mockResolvedValue(null);
  });

  it('returns isBvFamily true for BV family email', async () => {
    mockFindFamilyByContact.mockResolvedValue({
      fid: '42',
      name: 'Test Family',
      contacts: [{ type: 'email', value: 'bv@example.com' }],
      students: [],
      paymentStatus: 'paid',
    });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'bv@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(true);
      },
    });
  });

  it('returns isBvFamily false for non-BV email', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nonbv@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(false);
      },
    });
  });

  it('returns isBvFamily true with family contacts for valid family ID', async () => {
    mockFindFamilyById.mockResolvedValue({
      fid: '42',
      name: 'Test Family',
      contacts: [
        { type: 'email', value: 'parent@example.com' },
        { type: 'phone', value: '4165551234' },
      ],
      students: [],
      paymentStatus: 'paid',
    });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ familyId: '42' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(true);
        expect(data.familyEmails).toContain('parent@example.com');
        expect(data.familyPhones).toContain('4165551234');
      },
    });
  });

  it('returns isBvFamily false for unknown family ID', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ familyId: '99999' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(false);
      },
    });
  });

  it('returns 400 for missing email and familyId', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for invalid email format', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'not-an-email' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('defaults to non-BV when Firebase throws', async () => {
    mockFindFamilyByContact.mockRejectedValue(new Error('Firebase unavailable'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.isBvFamily).toBe(false);
      },
    });
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/app/api/events/check-bv-status/__tests__/route.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/events/check-bv-status/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { checkBvStatusRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { findFamilyById, findFamilyByContact } from '@/features/check-in/shared';
import { checkIpRateLimit } from '@/features/events/shared/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  try {
    const { allowed } = await checkIpRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 },
      );
    }
  } catch {
    // If rate limiter fails, allow the request (degraded mode)
  }

  let parsed: ReturnType<typeof checkBvStatusRequestSchema.parse>;
  try {
    parsed = checkBvStatusRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    if ('email' in parsed) {
      const family = await findFamilyByContact('email', parsed.email);
      if (family) {
        const emails = family.contacts
          .filter((c) => c.type === 'email')
          .map((c) => c.value.toLowerCase().trim());
        const phones = family.contacts
          .filter((c) => c.type === 'phone')
          .map((c) => c.value);
        return NextResponse.json({
          isBvFamily: true,
          familyEmails: emails,
          familyPhones: phones,
        });
      }
      return NextResponse.json({ isBvFamily: false });
    }

    // familyId lookup
    const family = await findFamilyById(parsed.familyId);
    if (family) {
      const emails = family.contacts
        .filter((c) => c.type === 'email')
        .map((c) => c.value.toLowerCase().trim());
      const phones = family.contacts
        .filter((c) => c.type === 'phone')
        .map((c) => c.value);
      return NextResponse.json({
        isBvFamily: true,
        familyEmails: emails,
        familyPhones: phones,
      });
    }
    return NextResponse.json({ isBvFamily: false });
  } catch (err) {
    console.error('BV status check failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ isBvFamily: false });
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```sh
pnpm --filter @cmt/portal test -- src/app/api/events/check-bv-status/__tests__/route.test.ts
```

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/events/check-bv-status/
git commit -m "feat(portal): POST /api/events/check-bv-status route with BV roster lookup"
```

---

## Task 5: `POST /api/events/register` route + test

**Files:**
- Create: `apps/portal/src/app/api/events/register/route.ts`
- Test: `apps/portal/src/app/api/events/register/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/events/register/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/lib/flags', () => ({
  flags: { eventsRegister: true },
}));

vi.mock('@/features/events/shared/rate-limiter', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const mockCreate = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/events/shared/firestore-adapter', () => ({
  registrationsCollection: () => ({
    doc: () => ({
      create: mockCreate,
    }),
  }),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => new Date().toISOString() },
  portalFirestore: vi.fn(),
}));

vi.mock('@/features/events/shared/google-sheets-sender', () => ({
  sendToGoogleSheet: vi.fn(),
}));

const mockAfterCallbacks: (() => Promise<void>)[] = [];
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (cb: () => Promise<void>) => { mockAfterCallbacks.push(cb); },
  };
});

import * as appHandler from '../route';

const validPayload = {
  registrationId: 'MD26-ABC1234',
  name: 'John Doe',
  email: 'john@example.com',
  phone: '416-555-0000',
  adults: 2,
  children: 1,
  payment_source: 'etransfer' as const,
  contribution: 15,
};

describe('POST /api/events/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
    mockAfterCallbacks.length = 0;
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = 'https://script.google.com/test';
  });

  it('returns success for valid payload', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.registrationId).toBe('MD26-ABC1234');
      },
    });
  });

  it('writes to Firebase with create()', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'john@example.com',
            paymentStatus: 'pending',
          }),
        );
      },
    });
  });

  it('returns 409 if registration ID already exists', async () => {
    mockCreate.mockRejectedValue(new Error('6 ALREADY_EXISTS: Document already exists'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(409);
      },
    });
  });

  it('returns 400 for invalid registrationId format', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, registrationId: 'abc' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for missing required fields', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: 'MD26-ABC1234' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 for adults below minimum', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, adults: 0 }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('accepts optional etransferReference field', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, etransferReference: 'C1AsjcyW6gqU' }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it('rejects etransferReference longer than 50 characters', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload, etransferReference: 'A'.repeat(51) }),
        });
        expect(res.status).toBe(400);
      },
    });
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/app/api/events/register/__tests__/route.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/events/register/route.ts`**

```ts
import { NextResponse, after } from 'next/server';
import { flags } from '@/lib/flags';
import { registerRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
import { sendToGoogleSheet } from '@/features/events/shared/google-sheets-sender';
import { checkIpRateLimit } from '@/features/events/shared/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  try {
    const { allowed } = await checkIpRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 },
      );
    }
  } catch {
    // Degraded mode
  }

  let parsed: ReturnType<typeof registerRequestSchema.parse>;
  try {
    parsed = registerRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Primary write: Firestore
  try {
    await registrationsCollection().doc(parsed.registrationId).create({
      ...parsed,
      paymentStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    const message = (err as Error).message || '';
    if (message.includes('ALREADY_EXISTS')) {
      return NextResponse.json(
        { error: 'Registration ID already exists' },
        { status: 409 },
      );
    }
    console.error('Firebase write failed:', message);
    // If Firebase fails, try Google Sheet as fallback
    const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    if (googleSheetUrl) {
      try {
        await fetch(googleSheetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
          redirect: 'follow',
          signal: AbortSignal.timeout(5000),
        });
        return NextResponse.json({ success: true, registrationId: parsed.registrationId });
      } catch {
        return NextResponse.json(
          { error: 'Registration failed. Please try again.' },
          { status: 503 },
        );
      }
    }
    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 503 },
    );
  }

  // Backup write: Google Sheet (fire-and-forget via after())
  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  if (googleSheetUrl) {
    after(async () => {
      await sendToGoogleSheet(googleSheetUrl, parsed);
    });
  }

  return NextResponse.json({ success: true, registrationId: parsed.registrationId });
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/events/register/
git commit -m "feat(portal): POST /api/events/register route with Firestore primary + Google Sheet backup"
```

---

## Task 6: `POST /api/events/lookup` route + test

**Files:**
- Create: `apps/portal/src/app/api/events/lookup/route.ts`
- Test: `apps/portal/src/app/api/events/lookup/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Port all tests from `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/api/lookup/route.test.ts`. Adapt mocks to use `@/features/events/shared/firestore-adapter` instead of `@/lib/firebase-admin`. Use `testApiHandler` + `appHandler` pattern. Include:
- Firestore hit returns registration data (200)
- Case-insensitive email match (200)
- Firestore miss falls back to Google Sheet (200)
- Firebase error falls back to Google Sheet (200)
- Payment status 'completed' returned correctly
- Defaults paymentStatus to 'pending' when field missing
- Returns 404 when both Firestore and Google Sheet miss
- Returns 404 when Google Sheet returns HTML
- Returns 404 when Google Sheet URL not configured and Firestore misses
- Returns 400 for missing registrationId, missing email, invalid email, empty body, invalid JSON

The full test code follows the same structure as the standalone `lookup/route.test.ts` (file: `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/api/lookup/route.test.ts`) with these changes:
- Mock path: `@/features/events/shared/firestore-adapter` instead of `@/lib/firebase-admin`
- Import: `import * as appHandler from '../route';`
- Wrap each test in `testApiHandler({ appHandler, test: async ({ fetch }) => { ... } })`
- Add `vi.mock('@/lib/flags', () => ({ flags: { eventsRegister: true } }));`

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/app/api/events/lookup/__tests__/route.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/events/lookup/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { lookupRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let parsed: ReturnType<typeof lookupRequestSchema.parse>;
  try {
    parsed = lookupRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Try Firebase first
  try {
    const doc = await registrationsCollection().doc(parsed.registrationId).get();

    if (doc.exists) {
      const data = doc.data()!;
      if (data.email?.toLowerCase() === parsed.email.toLowerCase()) {
        return NextResponse.json({
          registrationId: parsed.registrationId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          adults: data.adults,
          children: data.children,
          payment_source: data.payment_source,
          contribution: data.contribution,
          isBvFamily: data.isBvFamily || false,
          paymentStatus: data.paymentStatus || 'pending',
          etransferReference: data.etransferReference || '',
        });
      }
    }
  } catch (err) {
    console.error('Firebase lookup failed, falling back to Google Sheet:', err);
  }

  // Fallback to Google Sheet
  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  if (!googleSheetUrl) {
    return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
  }

  try {
    const url = `${googleSheetUrl}?registrationId=${encodeURIComponent(parsed.registrationId)}&email=${encodeURIComponent(parsed.email)}`;
    const response = await fetch(url, { redirect: 'follow' });

    if (!response.ok) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    const data = await response.json();
    if (data.email && data.email.toLowerCase() !== parsed.email.toLowerCase()) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error('Lookup failed:', err);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/events/lookup/
git commit -m "feat(portal): POST /api/events/lookup route with Firestore-first + Google Sheet fallback"
```

---

## Task 7: `POST /api/events/create-checkout` route + test

**Files:**
- Create: `apps/portal/src/app/api/events/create-checkout/route.ts`
- Test: `apps/portal/src/app/api/events/create-checkout/__tests__/route.test.ts`

**IMPORTANT CHANGES from standalone:**
1. Replace in-memory rate limiter with Firestore-backed `checkIpRateLimit`
2. Update `VERCEL_PROJECT_PATTERN` to match portal domain: `/^https:\/\/cmt-portal[a-z0-9-]*\.vercel\.app$/`
3. Add flag gate
4. Use `calculatePricing` from `@cmt/shared-domain/events/pricing` for server-side fee verification
5. Use `createCheckoutRequestSchema` from `@cmt/shared-domain/events/api-contracts`

- [ ] **Step 1: Write the failing test**

Port all tests from `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/api/create-checkout/route.test.ts`. Adapt:
- Add `vi.mock('@/lib/flags', ...)` and `vi.mock('@/features/events/shared/rate-limiter', ...)`
- Use `testApiHandler` pattern
- Update the `VERCEL_PROJECT_PATTERN` test to use portal domain patterns
- Rate limit test: mock `checkIpRateLimit` to return `{ allowed: false }` on 6th call

Include these test cases:
- Returns checkoutUrl for valid payload (200)
- Forwards payload to Stripe with API key header
- Returns 400 for missing lineItems
- Returns 400 for invalid client_reference_id format
- Returns 400 for invalid email
- Returns 400 for invalid line item name
- Returns 400 for manipulated per-person price
- Returns 400 for incorrect processing fee
- Accepts redirect URLs matching origin header
- Accepts redirect URLs with portal .vercel.app domain
- Rejects redirect URLs to external domains
- Returns 502 when Stripe returns error (no details leaked)
- Returns 429 when rate limited

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/app/api/events/create-checkout/__tests__/route.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/events/create-checkout/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { createCheckoutRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { checkIpRateLimit } from '@/features/events/shared/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRICE_PER_PERSON = 10.0;
const STRIPE_PERCENT_FEE = 0.022;
const STRIPE_FIXED_FEE = 0.3;

function verifyPricing(
  lineItems: { name: string; amount: number; quantity: number }[],
): boolean {
  for (const item of lineItems) {
    if (item.name === 'Adults' || item.name === 'Child' || item.name === 'BV Family') {
      if (item.amount !== PRICE_PER_PERSON) return false;
    }
    if (item.name === 'Processing Fees') {
      const otherItems = lineItems.filter((i) => i.name !== 'Processing Fees');
      const subtotal = otherItems.reduce(
        (sum, i) => sum + i.amount * i.quantity,
        0,
      );
      const expectedFee =
        Math.round((subtotal * STRIPE_PERCENT_FEE + STRIPE_FIXED_FEE) * 100) / 100;
      if (Math.abs(item.amount - expectedFee) > 0.01) return false;
    }
  }
  return true;
}

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  try {
    const { allowed } = await checkIpRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 },
      );
    }
  } catch {
    // Degraded mode
  }

  let parsed: ReturnType<typeof createCheckoutRequestSchema.parse>;
  try {
    parsed = createCheckoutRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Verify redirect URLs point to a safe origin
  const allowedOrigins = [
    req.headers.get('origin'),
    new URL(req.url).origin,
    req.headers.get('referer') ? new URL(req.headers.get('referer')!).origin : null,
  ].filter(Boolean) as string[];

  const successOrigin = new URL(parsed.successUrl).origin;
  const cancelOrigin = new URL(parsed.cancelUrl).origin;

  const VERCEL_PROJECT_PATTERN = /^https:\/\/cmt-portal[a-z0-9-]*\.vercel\.app$/;
  const isValidRedirect =
    allowedOrigins.some((o) => successOrigin === o) ||
    VERCEL_PROJECT_PATTERN.test(successOrigin);
  const isValidCancel =
    allowedOrigins.some((o) => cancelOrigin === o) ||
    VERCEL_PROJECT_PATTERN.test(cancelOrigin);

  if (!isValidRedirect || !isValidCancel) {
    return NextResponse.json(
      { error: 'Invalid redirect URLs' },
      { status: 400 },
    );
  }

  // Verify pricing server-side
  if (!verifyPricing(parsed.lineItems)) {
    return NextResponse.json({ error: 'Invalid pricing' }, { status: 400 });
  }

  // Forward validated payload to Stripe proxy
  const response = await fetch(process.env.STRIPE_CHECKOUT_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.STRIPE_API_KEY!,
    },
    body: JSON.stringify(parsed),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Stripe checkout error:', response.status, text);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 502 },
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/events/create-checkout/
git commit -m "feat(portal): POST /api/events/create-checkout route with Firestore rate limiter + portal domain allowlist"
```

---

## Task 8: `POST /api/events/update-reference` route + test

**Files:**
- Create: `apps/portal/src/app/api/events/update-reference/route.ts`
- Test: `apps/portal/src/app/api/events/update-reference/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Port all tests from `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/api/update-reference/route.test.ts`. Adapt mocks to use `@/features/events/shared/firestore-adapter` and `@/features/events/shared/google-sheets-sender`. Use `testApiHandler` pattern. Include:
- Returns success for valid payload with matching email (200)
- Email matching is case-insensitive
- Updates Firebase with set merge
- Forwards reference to Google Sheet
- Returns 404 when email does not match registration
- Returns 404 when registration does not exist
- Returns 502 when Firebase is down during verification
- Returns 400 for missing email, invalid registrationId format, missing etransferReference, etransferReference over 50 chars, empty body

The test structure follows the standalone file (`/Users/dineshmatta/projects/chinmaya-event-registration/src/app/api/update-reference/route.test.ts`) with these changes:
- Mock `@/features/events/shared/firestore-adapter` instead of `@/lib/firebase-admin`
- Mock `@/features/events/shared/google-sheets-sender` instead of using `fetch` directly
- Add `vi.mock('@/lib/flags', ...)`
- Wrap in `testApiHandler`

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/app/api/events/update-reference/__tests__/route.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/events/update-reference/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { updateReferenceRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
import { sendToGoogleSheet } from '@/features/events/shared/google-sheets-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let parsed: ReturnType<typeof updateReferenceRequestSchema.parse>;
  try {
    parsed = updateReferenceRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Verify email matches the registration for ownership verification
  try {
    const doc = await registrationsCollection().doc(parsed.registrationId).get();
    if (!doc.exists || doc.data()?.email?.toLowerCase() !== parsed.email.toLowerCase()) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }
  } catch (err) {
    console.error('Firebase lookup for update-reference failed:', (err as Error).message);
    return NextResponse.json({ error: 'Unable to verify registration' }, { status: 502 });
  }

  // Update Firebase
  try {
    await registrationsCollection().doc(parsed.registrationId).set(
      {
        etransferReference: parsed.etransferReference,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.error('Firebase update-reference failed:', (err as Error).message);
  }

  // Also update Google Sheet
  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  if (googleSheetUrl) {
    await sendToGoogleSheet(googleSheetUrl, {
      registrationId: parsed.registrationId,
      etransferReference: parsed.etransferReference,
      action: 'update_reference',
    });
  }

  return NextResponse.json({
    success: true,
    registrationId: parsed.registrationId,
  });
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/events/update-reference/
git commit -m "feat(portal): POST /api/events/update-reference route with email ownership check"
```

---

## Task 9: `POST /api/events/update-payment-status` route + test

**Files:**
- Create: `apps/portal/src/app/api/events/update-payment-status/route.ts`
- Test: `apps/portal/src/app/api/events/update-payment-status/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Port all tests from `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/api/update-payment-status/route.test.ts`. Adapt mocks to portal conventions. Use `testApiHandler` pattern. Include:
- Returns success for valid Stripe payment completion (200)
- Updates Firebase with completed status
- Forwards status update to Google Sheet
- Returns 400 for invalid registrationId format
- Returns 400 for non-completed paymentStatus
- Returns 400 for non-stripe payment_source
- Returns 400 for missing fields
- Returns 400 for invalid JSON
- Returns 404 when registration does not exist
- Returns 400 when registration is not a Stripe payment
- Still updates Firebase even if verification lookup fails
- Succeeds even if Google Sheet URL not configured

Mock changes from standalone:
- `@/features/events/shared/firestore-adapter` instead of `@/lib/firebase-admin`
- `@/features/events/shared/google-sheets-sender` for Google Sheet writes
- Add `vi.mock('@/lib/flags', ...)`

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/app/api/events/update-payment-status/__tests__/route.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/events/update-payment-status/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { updatePaymentStatusRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
import { sendToGoogleSheet } from '@/features/events/shared/google-sheets-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let parsed: ReturnType<typeof updatePaymentStatusRequestSchema.parse>;
  try {
    parsed = updatePaymentStatusRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Verify the registration exists and is a Stripe payment
  try {
    const doc = await registrationsCollection().doc(parsed.registrationId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }
    const data = doc.data()!;
    if (data.payment_source !== 'stripe') {
      return NextResponse.json({ error: 'Not a Stripe payment' }, { status: 400 });
    }
  } catch (err) {
    console.error('Firebase lookup failed:', (err as Error).message);
    // Continue with update attempt even if verification fails
  }

  // Update Firebase
  try {
    await registrationsCollection().doc(parsed.registrationId).set(
      {
        paymentStatus: 'completed',
        payment_source: 'stripe',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.error('Firebase payment status update failed:', (err as Error).message);
  }

  // Also update Google Sheet
  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  if (googleSheetUrl) {
    sendToGoogleSheet(googleSheetUrl, {
      registrationId: parsed.registrationId,
      paymentStatus: 'completed',
      payment_source: 'stripe',
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  return NextResponse.json({
    success: true,
    registrationId: parsed.registrationId,
  });
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/events/update-payment-status/
git commit -m "feat(portal): POST /api/events/update-payment-status route for Stripe success page"
```

---

## Task 10: `POST /api/events/webhooks/payment-status` route + test

**Files:**
- Create: `apps/portal/src/app/api/events/webhooks/payment-status/route.ts`
- Test: `apps/portal/src/app/api/events/webhooks/payment-status/__tests__/route.test.ts`

**NOTE:** This route is NOT flag-gated. It always listens.

- [ ] **Step 1: Write the failing test**

Port all tests from `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/api/webhooks/payment-status/route.test.ts`. Adapt mocks to portal conventions. Include:
- Returns 401 when x-api-key header is missing
- Returns 401 when x-api-key is invalid
- Returns 401 when WEBHOOK_API_KEY env var is not set
- Returns success for valid payload with correct API key (200)
- Returns 400 when registrationId is missing
- Returns 400 when paymentStatus is missing
- Returns 400 for invalid registrationId format
- Returns 400 for invalid paymentStatus value
- Returns 400 when body is empty
- Returns 400 for invalid JSON body
- Forwards payment status to Google Sheet
- Defaults payment_source to 'unknown'
- Succeeds even if Google Sheet call fails
- Skips Google Sheet when URL not configured
- Accepts all valid paymentStatus values (completed, pending, failed, refunded)

Mock changes from standalone:
- `@/features/events/shared/firestore-adapter` instead of `@/lib/firebase-admin`
- `@/features/events/shared/google-sheets-sender` for Google Sheet writes
- No `vi.mock('@/lib/flags')` needed — this route is not flag-gated

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/app/api/events/webhooks/payment-status/__tests__/route.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/events/webhooks/payment-status/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { webhookPaymentStatusRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
import { sendToGoogleSheet } from '@/features/events/shared/google-sheets-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: Request) {
  // NOTE: This route is NOT flag-gated. Webhooks must survive flag flips.

  // Verify API key with constant-time comparison
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.WEBHOOK_API_KEY;
  if (!apiKey || !expectedKey || !safeEqual(apiKey, expectedKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();

    let parsed: ReturnType<typeof webhookPaymentStatusRequestSchema.parse>;
    try {
      parsed = webhookPaymentStatusRequestSchema.parse(body);
    } catch {
      return NextResponse.json(
        { error: 'registrationId and paymentStatus are required' },
        { status: 400 },
      );
    }

    // Update Firebase
    try {
      await registrationsCollection().doc(parsed.registrationId).set(
        {
          paymentStatus: parsed.paymentStatus,
          payment_source: parsed.payment_source,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.error('Firebase payment-status update failed:', (err as Error).message);
    }

    // Also update Google Sheet
    const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    if (googleSheetUrl) {
      await sendToGoogleSheet(googleSheetUrl, {
        registrationId: parsed.registrationId,
        paymentStatus: parsed.paymentStatus,
        payment_source: parsed.payment_source,
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      registrationId: parsed.registrationId,
      paymentStatus: parsed.paymentStatus,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/events/webhooks/
git commit -m "feat(portal): POST /api/events/webhooks/payment-status with timingSafeEqual API key auth (not flag-gated)"
```

---

## Task 11: UI components — CounterInput, StepIndicator, OrderSummary, SuccessBanner, CancelBanner

**Files:**
- Create: `apps/portal/src/features/events/counter-input.tsx`
- Create: `apps/portal/src/features/events/step-indicator.tsx`
- Create: `apps/portal/src/features/events/order-summary.tsx`
- Create: `apps/portal/src/features/events/success-banner.tsx`
- Create: `apps/portal/src/features/events/cancel-banner.tsx`
- Create: `apps/portal/src/features/events/index.ts`
- Test: `apps/portal/src/features/events/__tests__/counter-input.test.tsx`
- Test: `apps/portal/src/features/events/__tests__/step-indicator.test.tsx`
- Test: `apps/portal/src/features/events/__tests__/order-summary.test.tsx`
- Test: `apps/portal/src/features/events/__tests__/success-banner.test.tsx`
- Test: `apps/portal/src/features/events/__tests__/cancel-banner.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/portal/src/features/events/__tests__/counter-input.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CounterInput } from '../counter-input';

describe('CounterInput', () => {
  it('renders label and current value', () => {
    render(<CounterInput label="Adults" value={2} min={1} onChange={() => {}} />);
    expect(screen.getByText('Adults')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls onChange with incremented value on + click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CounterInput label="Adults" value={2} min={1} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /\+/i }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('calls onChange with decremented value on - click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CounterInput label="Adults" value={2} min={1} onChange={onChange} />);
    // The minus button contains the &minus; entity
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]); // first button is minus
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('disables - button at min value', () => {
    render(<CounterInput label="Adults" value={1} min={1} onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toBeDisabled();
  });

  it('disables + button at max value', () => {
    render(<CounterInput label="Adults" value={50} min={1} max={50} onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1]).toBeDisabled();
  });
});
```

```tsx
// apps/portal/src/features/events/__tests__/step-indicator.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepIndicator } from '../step-indicator';

describe('StepIndicator', () => {
  it('renders step 1 as active when currentStep is 1', () => {
    render(<StepIndicator currentStep={1} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders checkmark for step 1 when currentStep is 2', () => {
    const { container } = render(<StepIndicator currentStep={2} />);
    // Step 1 should show a checkmark SVG instead of "1"
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
```

```tsx
// apps/portal/src/features/events/__tests__/order-summary.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderSummary } from '../order-summary';

describe('OrderSummary', () => {
  it('renders adult line item', () => {
    render(
      <OrderSummary
        adults={2}
        children={0}
        subtotal={20}
        processingFee={0}
        total={20}
        paymentMethod="etransfer"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Adults x 2/)).toBeInTheDocument();
    expect(screen.getByText('$20.00')).toBeInTheDocument();
  });

  it('renders children line item when children > 0', () => {
    render(
      <OrderSummary
        adults={1}
        children={2}
        subtotal={30}
        processingFee={0}
        total={30}
        paymentMethod="etransfer"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Children x 2/)).toBeInTheDocument();
  });

  it('renders processing fee for stripe', () => {
    render(
      <OrderSummary
        adults={2}
        children={0}
        subtotal={20}
        processingFee={0.74}
        total={20.74}
        paymentMethod="stripe"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Processing Fee/)).toBeInTheDocument();
    expect(screen.getByText('$0.74')).toBeInTheDocument();
  });

  it('renders BV family label', () => {
    render(
      <OrderSummary
        adults={3}
        children={2}
        subtotal={10}
        processingFee={0}
        total={10}
        paymentMethod="etransfer"
        isBvFamily={true}
      />,
    );
    expect(screen.getByText(/BV Family/)).toBeInTheDocument();
  });

  it('renders total amount', () => {
    render(
      <OrderSummary
        adults={1}
        children={0}
        subtotal={10}
        processingFee={0}
        total={10}
        paymentMethod="etransfer"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Total Amount/)).toBeInTheDocument();
  });
});
```

```tsx
// apps/portal/src/features/events/__tests__/success-banner.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuccessBanner } from '../success-banner';

describe('SuccessBanner', () => {
  it('renders payment confirmed text', () => {
    render(<SuccessBanner />);
    expect(screen.getByText('Payment Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/registration is complete/i)).toBeInTheDocument();
  });
});
```

```tsx
// apps/portal/src/features/events/__tests__/cancel-banner.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CancelBanner } from '../cancel-banner';

describe('CancelBanner', () => {
  it('renders payment cancelled text', () => {
    render(<CancelBanner />);
    expect(screen.getByText('Payment Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/retry your payment/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/features/events/__tests__/counter-input.test.tsx
pnpm --filter @cmt/portal test -- src/features/events/__tests__/step-indicator.test.tsx
pnpm --filter @cmt/portal test -- src/features/events/__tests__/order-summary.test.tsx
pnpm --filter @cmt/portal test -- src/features/events/__tests__/success-banner.test.tsx
pnpm --filter @cmt/portal test -- src/features/events/__tests__/cancel-banner.test.tsx
```

- [ ] **Step 3: Create `apps/portal/src/features/events/counter-input.tsx`**

Port 1:1 from `/Users/dineshmatta/projects/chinmaya-event-registration/src/components/CounterInput.tsx`. Only change: use named export `CounterInput` instead of default export.

```tsx
'use client';

interface CounterInputProps {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}

export function CounterInput({ label, value, min, max = 50, onChange }: CounterInputProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-base text-gray-700">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-xl text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          &minus;
        </button>
        <span className="w-8 text-center text-lg font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-xl text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/features/events/step-indicator.tsx`**

Port 1:1 from `/Users/dineshmatta/projects/chinmaya-event-registration/src/components/StepIndicator.tsx`. Use named export.

```tsx
'use client';

interface StepIndicatorProps {
  currentStep: 1 | 2;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-gray-900 text-white"
      >
        {currentStep > 1 ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          '1'
        )}
      </div>
      <div className="w-16 h-0.5 bg-gray-300" />
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
          currentStep === 2
            ? 'bg-gray-900 text-white'
            : 'bg-white text-gray-400 border-2 border-gray-300'
        }`}
      >
        2
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/features/events/order-summary.tsx`**

```tsx
'use client';

interface OrderSummaryProps {
  adults: number;
  children: number;
  subtotal: number;
  processingFee: number;
  total: number;
  paymentMethod: 'etransfer' | 'stripe';
  isBvFamily: boolean;
}

export function OrderSummary({
  adults,
  children,
  subtotal,
  processingFee,
  total,
  paymentMethod,
  isBvFamily,
}: OrderSummaryProps) {
  return (
    <div className="border border-gray-200 rounded-xl p-6 mb-4">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>
      <div className="space-y-2">
        {isBvFamily ? (
          <div className="flex justify-between text-gray-700">
            <span>BV Family (flat rate)</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
        ) : (
          <>
            <div className="flex justify-between text-gray-700">
              <span>Adults x {adults}</span>
              <span>${(adults * (subtotal / Math.max(adults + children, 1))).toFixed(2)}</span>
            </div>
            {children > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Children x {children}</span>
                <span>${(children * (subtotal / Math.max(adults + children, 1))).toFixed(2)}</span>
              </div>
            )}
          </>
        )}
        {paymentMethod === 'stripe' && processingFee > 0 && (
          <div className="flex justify-between text-gray-500 text-sm">
            <span>Processing Fee (2.20% + 30c)</span>
            <span>${processingFee.toFixed(2)}</span>
          </div>
        )}
        <div className="border-t border-gray-200 pt-2 mt-2">
          <div className="flex justify-between font-bold text-gray-900">
            <span>Total Amount</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `apps/portal/src/features/events/success-banner.tsx`**

```tsx
'use client';

export function SuccessBanner() {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-green-700 font-bold text-lg">Payment Confirmed</p>
          <p className="text-green-600 text-sm mt-1">Your registration is complete!</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `apps/portal/src/features/events/cancel-banner.tsx`**

```tsx
'use client';

export function CancelBanner() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
          <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <p className="text-amber-700 font-bold text-lg">Payment Cancelled</p>
          <p className="text-amber-600 text-sm mt-1">You can retry your payment or start a new registration</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create `apps/portal/src/features/events/index.ts`**

```ts
export { CounterInput } from './counter-input';
export { StepIndicator } from './step-indicator';
export { OrderSummary } from './order-summary';
export { SuccessBanner } from './success-banner';
export { CancelBanner } from './cancel-banner';
```

- [ ] **Step 9: Run tests — expect pass**

```sh
pnpm --filter @cmt/portal test -- src/features/events/__tests__/
```

- [ ] **Step 10: Commit**

```sh
git add apps/portal/src/features/events/counter-input.tsx apps/portal/src/features/events/step-indicator.tsx apps/portal/src/features/events/order-summary.tsx apps/portal/src/features/events/success-banner.tsx apps/portal/src/features/events/cancel-banner.tsx apps/portal/src/features/events/index.ts apps/portal/src/features/events/__tests__/
git commit -m "feat(portal): events UI components — CounterInput, StepIndicator, OrderSummary, SuccessBanner, CancelBanner"
```

---

## Task 12: EventRegistrationForm client component + `/events/register` page

**Files:**
- Create: `apps/portal/src/features/events/registration-form.tsx`
- Create: `apps/portal/src/features/events/registration-form-shell.tsx`
- Create: `apps/portal/src/app/events/register/page.tsx`
- Create: `apps/portal/src/app/events/register/error.tsx`
- Create: `apps/portal/src/app/events/register/loading.tsx`

**Source reference:** READ `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/page.tsx` (718 lines) for the full registration form. The portal version makes these SPECIFIC changes:

- [ ] **Step 1: Create `apps/portal/src/features/events/registration-form-shell.tsx`**

Server component that reads env vars and passes them as props to the client form.

```tsx
import { flags } from '@/lib/flags';
import { notFound } from 'next/navigation';
import { EventRegistrationForm } from './registration-form';

export function RegistrationFormShell() {
  if (!flags.eventsRegister) notFound();

  const config = {
    eventDisplayName: process.env.NEXT_PUBLIC_EVENT_DISPLAY_NAME || 'Event',
    eventPosterUrl: process.env.NEXT_PUBLIC_EVENT_POSTER_URL || '',
    eventCampaign: process.env.NEXT_PUBLIC_EVENT_CAMPAIGN || '2026MothersDay',
    pricePerPerson: Number(process.env.NEXT_PUBLIC_PRICE_PER_PERSON || '10'),
    enableStripe: process.env.NEXT_PUBLIC_ENABLE_STRIPE === 'true',
    etransferEmail: process.env.NEXT_PUBLIC_ETRANSFER_EMAIL || '',
  };

  return <EventRegistrationForm config={config} />;
}
```

- [ ] **Step 2: Create `apps/portal/src/features/events/registration-form.tsx`**

Port from `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/page.tsx`. This is a large (~700 line) client component. READ the standalone file and apply these SPECIFIC changes:

1. **Imports:** Replace standalone imports with portal equivalents:
   - `import { CounterInput, StepIndicator } from '@/features/events';` (from barrel)
   - `import { calculatePricing } from '@cmt/shared-domain/events/pricing';`
   - Remove `import { generateRegistrationId, calculateTotals, saveRegistration } from "@/lib/utils";`
   - Remove `import { submitRegistration, createCheckoutSession, lookupRegistration } from "@/lib/api";`

2. **Props interface:** Accept a `config` prop instead of reading `process.env` directly:
   ```tsx
   interface EventConfig {
     eventDisplayName: string;
     eventPosterUrl: string;
     eventCampaign: string;
     pricePerPerson: number;
     enableStripe: boolean;
     etransferEmail: string;
   }
   export function EventRegistrationForm({ config }: { config: EventConfig }) {
   ```

3. **Pricing calculation:** Replace `calculateTotals(adults, children, paymentMethod, isBvFamily)` with:
   ```tsx
   const totals = useMemo(
     () => calculatePricing({
       adults, children, isBvFamily, paymentMethod, pricePerPerson: config.pricePerPerson,
     }),
     [adults, children, paymentMethod, isBvFamily, config.pricePerPerson],
   );
   ```

4. **Registration ID generation:** Inline the `generateRegistrationId()` function (same logic as standalone `utils.ts`):
   ```tsx
   function generateRegistrationId(): string {
     const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
     const array = new Uint8Array(7);
     crypto.getRandomValues(array);
     return `MD26-${Array.from(array, (byte) => chars[byte % chars.length]).join('')}`;
   }
   ```

5. **Session storage key:** Change from `cmt_registration` to `cmtEventRegistration` (per spec).

6. **API URLs:** Change from standalone paths to portal paths:
   - `/api/check-bv-status` -> `/api/events/check-bv-status`
   - `/api/register` -> `/api/events/register`
   - `/api/create-checkout` -> `/api/events/create-checkout`
   - `/api/lookup` -> `/api/events/lookup`

7. **Navigation URLs:** Change from standalone paths to portal paths:
   - `router.push("/payment")` -> `router.push("/events/register/payment")`
   - Success URL: `${origin}/success?regId=...` -> `${origin}/events/register/success?regId=...`
   - Cancel URL: `${origin}/cancel?regId=...` -> `${origin}/events/register/cancel?regId=...`

8. **Stripe toggle:** Use `config.enableStripe` instead of `process.env.NEXT_PUBLIC_ENABLE_STRIPE !== "false"`.

9. **Event display name:** Use `config.eventDisplayName` instead of `process.env.NEXT_PUBLIC_EVENT_DISPLAY_NAME`.

10. **Poster URL:** Use `config.eventPosterUrl` instead of `process.env.NEXT_PUBLIC_EVENT_POSTER_URL`.

11. **Named export:** Use `export function EventRegistrationForm` instead of `export default function RegistrationPage`.

12. **Add to barrel:** Add `export { EventRegistrationForm } from './registration-form';` and `export { RegistrationFormShell } from './registration-form-shell';` to `index.ts`.

- [ ] **Step 3: Create `apps/portal/src/app/events/register/page.tsx`**

```tsx
import { RegistrationFormShell } from '@/features/events/registration-form-shell';

export const metadata = { title: 'Register — CMT Portal' };
export const dynamic = 'force-dynamic';

export default function EventsRegisterPage() {
  return <RegistrationFormShell />;
}
```

- [ ] **Step 4: Create `apps/portal/src/app/events/register/error.tsx`**

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function EventsRegisterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Event Registration" />;
}
```

- [ ] **Step 5: Create `apps/portal/src/app/events/register/loading.tsx`**

```tsx
export default function EventsRegisterLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
```

- [ ] **Step 6: Verify build compiles**

```sh
pnpm --filter @cmt/portal build
```

- [ ] **Step 7: Commit**

```sh
git add apps/portal/src/features/events/registration-form.tsx apps/portal/src/features/events/registration-form-shell.tsx apps/portal/src/features/events/index.ts apps/portal/src/app/events/register/
git commit -m "feat(portal): /events/register page with EventRegistrationForm — BV verify, lookup, submit flows"
```

---

## Task 13: PaymentInstructions client component + `/events/register/payment` page

**Files:**
- Create: `apps/portal/src/features/events/payment-instructions.tsx`
- Create: `apps/portal/src/app/events/register/payment/page.tsx`
- Create: `apps/portal/src/app/events/register/payment/error.tsx`

**Source reference:** READ `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/payment/page.tsx` (372 lines).

- [ ] **Step 1: Create `apps/portal/src/features/events/payment-instructions.tsx`**

Port from standalone `payment/page.tsx`. Apply these SPECIFIC changes:

1. **Imports:**
   - `import { StepIndicator, OrderSummary } from '@/features/events';`
   - `import { calculatePricing } from '@cmt/shared-domain/events/pricing';`
   - Remove all standalone utils/types imports.

2. **Session storage key:** `cmtEventRegistration` (same as Task 12).

3. **Session storage helpers:** Inline `loadRegistration`, `saveRegistration`, `clearRegistration` using the new storage key.

4. **API URLs:**
   - `/api/update-reference` -> `/api/events/update-reference`
   - `/api/lookup` -> `/api/events/lookup`

5. **Navigation URLs:**
   - `router.push("/")` -> `router.push("/events/register")`

6. **Window focus refresh:** On `window.addEventListener('focus', ...)`, call `/api/events/lookup` with the stored `registrationId` and `email` to refresh payment status (matches standalone behavior).

7. **Named export:** `export function PaymentInstructions`

8. **Add to barrel:** Add `export { PaymentInstructions } from './payment-instructions';` to `index.ts`.

- [ ] **Step 2: Create `apps/portal/src/app/events/register/payment/page.tsx`**

```tsx
'use client';

import { PaymentInstructions } from '@/features/events/payment-instructions';

export default function EventsPaymentPage() {
  return <PaymentInstructions />;
}
```

Note: This is a client page because it reads sessionStorage in useEffect. The flag gate is implicit — the user can only reach this page after a successful registration which requires the flag to be on.

- [ ] **Step 3: Create `apps/portal/src/app/events/register/payment/error.tsx`**

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function EventsPaymentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Event Payment" />;
}
```

- [ ] **Step 4: Commit**

```sh
git add apps/portal/src/features/events/payment-instructions.tsx apps/portal/src/features/events/index.ts apps/portal/src/app/events/register/payment/
git commit -m "feat(portal): /events/register/payment page with e-Transfer instructions + Stripe pay button"
```

---

## Task 14: `/events/register/success` page + `/events/register/cancel` page

**Files:**
- Create: `apps/portal/src/app/events/register/success/page.tsx`
- Create: `apps/portal/src/app/events/register/success/error.tsx`
- Create: `apps/portal/src/app/events/register/cancel/page.tsx`
- Create: `apps/portal/src/app/events/register/cancel/error.tsx`

**Source reference:** READ:
- `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/success/page.tsx` (202 lines)
- `/Users/dineshmatta/projects/chinmaya-event-registration/src/app/cancel/page.tsx` (206 lines)

- [ ] **Step 1: Create `apps/portal/src/app/events/register/success/page.tsx`**

Port from standalone `success/page.tsx`. Apply these SPECIFIC changes:

1. **Imports:**
   - `import { StepIndicator, OrderSummary, SuccessBanner } from '@/features/events';`
   - Remove standalone component/utils imports.

2. **Session storage key:** `cmtEventRegistration`.

3. **API URL:** `/api/update-payment-status` -> `/api/events/update-payment-status`

4. **Navigation:** `router.push("/")` -> `router.push("/events/register")`

5. **Use `<OrderSummary>` component** instead of inline order summary JSX.

6. **Use `<SuccessBanner>` component** instead of inline success banner JSX.

7. **Event display name:** Read from `process.env.NEXT_PUBLIC_EVENT_DISPLAY_NAME` (same as standalone — this is a `NEXT_PUBLIC_` var so it's available in client components).

- [ ] **Step 2: Create `apps/portal/src/app/events/register/success/error.tsx`**

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function EventsSuccessError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Event Registration Success" />;
}
```

- [ ] **Step 3: Create `apps/portal/src/app/events/register/cancel/page.tsx`**

Port from standalone `cancel/page.tsx`. Apply these SPECIFIC changes:

1. **Imports:**
   - `import { StepIndicator, OrderSummary, CancelBanner } from '@/features/events';`

2. **Session storage key:** `cmtEventRegistration`.

3. **Navigation:** `router.push("/")` -> `router.push("/events/register")`

4. **Use `<OrderSummary>` component** instead of inline order summary JSX.

5. **Use `<CancelBanner>` component** instead of inline cancel banner JSX.

- [ ] **Step 4: Create `apps/portal/src/app/events/register/cancel/error.tsx`**

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function EventsCancelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Event Registration Cancel" />;
}
```

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/events/register/success/ apps/portal/src/app/events/register/cancel/
git commit -m "feat(portal): /events/register/success and /events/register/cancel pages"
```

---

## Task 15: Full-suite checkpoint

**Files:** None created. Fix any regressions found.

- [ ] **Step 1: Run typecheck**

```sh
pnpm typecheck
```

- [ ] **Step 2: Run lint**

```sh
pnpm lint
```

- [ ] **Step 3: Run tests**

```sh
pnpm test
```

- [ ] **Step 4: Run build**

```sh
pnpm build
```

- [ ] **Step 5: Fix any failures**

If any step fails, fix the root cause. Common issues:
- Missing exports in barrel files
- Type mismatches between Zod schemas and TypeScript interfaces
- Import path errors (ensure `@/features/events/*` resolves correctly)
- `eslint-plugin-boundaries` violations if events imports from check-in features directly (should go through `@/features/check-in/shared` which is allowed as same-app re-export)
- Unused variables or imports flagged by lint

- [ ] **Step 6: Commit any fixes**

```sh
git add -A
git commit -m "fix(portal): resolve full-suite checkpoint regressions for slice C"
```

Only commit if there were actual fixes. Skip if everything passed clean.

---

## Task 16: Playwright e2e + docs + final push

**Files:**
- Create: `apps/portal/e2e/c-events.spec.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create `apps/portal/e2e/c-events.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.describe('Slice C — Event Registration (flag OFF)', () => {
  // These tests run against the default env where NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=false
  // in CI/production. They verify the flag gate works.

  test('/events/register returns 404 when flag is off', async ({ page }) => {
    const response = await page.goto('/events/register');
    // notFound() in Next.js renders a 404 page
    expect(response?.status()).toBe(404);
  });

  test('/events/register/payment returns 404 when flag is off', async ({ page }) => {
    const response = await page.goto('/events/register/payment');
    expect(response?.status()).toBe(404);
  });

  test('/events/register/success returns 404 when flag is off', async ({ page }) => {
    const response = await page.goto('/events/register/success');
    expect(response?.status()).toBe(404);
  });

  test('/events/register/cancel returns 404 when flag is off', async ({ page }) => {
    const response = await page.goto('/events/register/cancel');
    expect(response?.status()).toBe(404);
  });

  test('webhook endpoint returns 401 without API key (always live)', async ({ request }) => {
    const response = await request.post('/api/events/webhooks/payment-status', {
      data: { registrationId: 'MD26-ABC1234', paymentStatus: 'completed' },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('Slice C — Event Registration (flag ON)', () => {
  // These tests require NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=true in the test environment.
  // They verify the registration form renders and basic interactions work.

  test.skip(
    process.env.NEXT_PUBLIC_FEATURE_EVENTS_REGISTER !== 'true',
    'Skipped: NEXT_PUBLIC_FEATURE_EVENTS_REGISTER is not true',
  );

  test('/events/register renders the registration form', async ({ page }) => {
    await page.goto('/events/register');
    await expect(page.getByText('Registration')).toBeVisible();
    await expect(page.getByText(/BV/i)).toBeVisible();
  });

  test('poster is visible on desktop, hidden on mobile', async ({ page }) => {
    // Desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/events/register');
    // Poster may or may not be present depending on env var
    // If present, it should be visible on desktop
    const poster = page.locator('img[alt*="poster" i], img[alt*="Event" i]');
    if (await poster.count() > 0) {
      await expect(poster.first()).toBeVisible();
    }

    // Mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/events/register');
    if (await poster.count() > 0) {
      await expect(poster.first()).toBeHidden();
    }
  });

  test('lookup banner toggles', async ({ page }) => {
    await page.goto('/events/register');
    const lookupButton = page.getByText(/look up your registration/i);
    if (await lookupButton.isVisible()) {
      await lookupButton.click();
      await expect(page.getByPlaceholder(/MD26/i)).toBeVisible();
    }
  });
});
```

- [ ] **Step 2: Update `CLAUDE.md`**

Add slice C status and notes. After the existing "Slice B status" paragraph, add:

```
**Slice C status:** Shipped (merged to `main`). Spec: `docs/superpowers/specs/2026-04-15-slice-c-event-registration-port-design.md`, plan: `docs/superpowers/plans/2026-04-15-slice-c-event-registration-port.md`.
```

Add a new "C notes" section after the "B2 notes" section:

```
## C notes

1. **Parallel run:** Both the standalone `chinmaya-event-registration` and the portal's `/events/register` write to the same Firestore collection (`events/2026MothersDay/registrations/*`). Cutover (flipping the public register link, updating Vaibhav's webhook URL, and updating the Cloud Run Stripe proxy allowlist) is coordinated manually post-slice.

2. **Feature flag:** `flags.eventsRegister` gates all pages and API routes except `/api/events/webhooks/payment-status` (which is always live, gated only by `WEBHOOK_API_KEY`). Vercel Production starts with `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=false`.

3. **Stripe:** `NEXT_PUBLIC_ENABLE_STRIPE=false` in Vercel Production until the Cloud Run proxy allowlist is updated to include portal domains. e-Transfer works from day one.

4. **Session storage key:** `cmtEventRegistration` (different from standalone's `cmt_registration`) — the two apps' sessions are independent.

5. **Rate limiter:** Events API routes use a Firestore-backed IP rate limiter (`event_rate_limit` collection), same pattern as the OTP rate limiter from slice B2 (`otp_rate_limit` collection). No in-memory rate limiting (serverless-safe).
```

- [ ] **Step 3: Run full suite one final time**

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 4: Commit docs + e2e**

```sh
git add apps/portal/e2e/c-events.spec.ts CLAUDE.md
git commit -m "docs: mark slice C shipped + add Playwright e2e for event registration"
```

- [ ] **Step 5: Push**

```sh
git push origin main
```

The pre-push hook runs `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. If any check fails, fix the underlying issue and push again. NEVER use `--no-verify`.

---

## Summary

| Task | Description | Files | Commit |
|------|-------------|-------|--------|
| 1 | shared-domain events types + pricing + API contracts | 7 | `feat(shared-domain): add events types, calculatePricing, and API contract Zod schemas` |
| 2 | Feature flag + env schema | 3 | `feat(portal): add eventsRegister flag + event env vars to env schema` |
| 3 | Shared helpers (bv-contacts, firestore-adapter, google-sheets-sender, rate-limiter) | 7 | `feat(portal): events shared helpers` |
| 4 | POST /api/events/check-bv-status | 2 | `feat(portal): POST /api/events/check-bv-status route` |
| 5 | POST /api/events/register | 2 | `feat(portal): POST /api/events/register route` |
| 6 | POST /api/events/lookup | 2 | `feat(portal): POST /api/events/lookup route` |
| 7 | POST /api/events/create-checkout | 2 | `feat(portal): POST /api/events/create-checkout route` |
| 8 | POST /api/events/update-reference | 2 | `feat(portal): POST /api/events/update-reference route` |
| 9 | POST /api/events/update-payment-status | 2 | `feat(portal): POST /api/events/update-payment-status route` |
| 10 | POST /api/events/webhooks/payment-status | 2 | `feat(portal): POST /api/events/webhooks/payment-status` |
| 11 | UI components (5 components + barrel + tests) | 11 | `feat(portal): events UI components` |
| 12 | EventRegistrationForm + /events/register page | 5 | `feat(portal): /events/register page` |
| 13 | PaymentInstructions + /events/register/payment | 3 | `feat(portal): /events/register/payment page` |
| 14 | Success + Cancel pages | 4 | `feat(portal): success and cancel pages` |
| 15 | Full-suite checkpoint | 0 | `fix(portal): resolve full-suite checkpoint regressions` (if needed) |
| 16 | Playwright e2e + docs + push | 2 | `docs: mark slice C shipped + Playwright e2e` |
