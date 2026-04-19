# Events API Reference

All endpoints live under `/api/events/`. All requests and responses use `application/json`.

Most endpoints are flag-gated: they return `404` when `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER` is unset or `false`. The webhook endpoint is always active.

## Shared-domain import paths

```ts
import {
  // Request schemas
  verifyRegistrationRequestSchema,
  registerRequestSchema,
  lookupRequestSchema,
  createCheckoutRequestSchema,
  updateReferenceRequestSchema,
  updatePaymentStatusRequestSchema,
  webhookPaymentStatusRequestSchema,
  checkBvStatusRequestSchema,

  // Response schemas
  checkBvStatusResponseSchema,
  existingRegistrationSchema,

  // Types
  type VerifyRegistrationRequest,
  type RegisterRequest,
  type LookupRequest,
  type CreateCheckoutRequest,
  type UpdateReferenceRequest,
  type UpdatePaymentStatusRequest,
  type WebhookPaymentStatusRequest,
  type CheckBvStatusRequest,
  type CheckBvStatusResponse,
  type ExistingRegistrationResult,
} from '@cmt/shared-domain/events/api-contracts';

import {
  type EventRegistration,
  type RegistrationPaymentStatus,
  type RegistrationCategory,
  type PaymentSource,
  PAYMENT_SOURCES,
  REGISTRATION_PAYMENT_STATUSES,
  REGISTRATION_CATEGORIES,
} from '@cmt/shared-domain/events/registration';
```

---

## 1. POST /api/events/verify-registration

**Purpose:** Pre-registration check. Determines whether a contact is a BV family member, a sevak, or a regular attendee, and detects duplicate registrations.

**Auth:** None (IP rate-limited)

**Flag-gated:** Yes

### Request variants (union — send exactly one discriminating key)

| Variant | Required fields | Notes |
|---|---|---|
| BV by email | `email` | Looks up RTDB roster by email |
| BV by familyId | `familyId` | Looks up RTDB roster by family ID |
| Sevak | `sevakEmail` | Checks the Airtable sevak list |
| Non-BV duplicate | `checkDuplicateEmail` + `category: "non-bv"` | Email-only duplicate check |

```json
// BV email variant
{ "email": "parent@example.com" }

// BV familyId variant
{ "familyId": "42" }

// Sevak variant
{ "sevakEmail": "teacher@example.com" }

// Non-BV duplicate check
{ "checkDuplicateEmail": "user@example.com", "category": "non-bv" }
```

### Response

```json
// BV family found
{
  "isBvFamily": true,
  "fid": "42",
  "familyEmails": ["parent@example.com"],
  "familyPhones": ["4165551234"],
  "existingRegistration": {
    "registrationId": "MD26-ABC1234",
    "paymentStatus": "pending"
  }
}

// Not a BV family
{ "isBvFamily": false }

// Sevak found
{
  "isSevak": true,
  "existingRegistration": { "registrationId": "MD26-SEV0001", "paymentStatus": "pending" }
}

// Non-BV duplicate check
{ "existingRegistration": { "registrationId": "MD26-NBV5678", "paymentStatus": "pending" } }
```

`existingRegistration` is omitted (not `null`) when no prior registration exists.

### Error codes

| Status | Meaning |
|---|---|
| 400 | Missing/invalid fields or invalid email format |
| 404 | Feature flag off |
| 429 | Rate limited |

---

## 2. POST /api/events/register

**Purpose:** Creates a new event registration. Writes to Firestore (primary) and Google Sheets (async fallback).

**Auth:** None (IP rate-limited)

**Flag-gated:** Yes

### Request

```json
{
  "registrationId": "MD26-ABC1234",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "416-555-0000",
  "adults": 2,
  "children": 1,
  "payment_source": "etransfer",
  "contribution": 30,
  "isBvFamily": true,
  "category": "bv-family",
  "additionalAttendees": 0,
  "mothersInPuja": 1,
  "fid": "42",
  "etransferReference": "C1AsjcyW6gqU"
}
```

Required: `registrationId`, `name`, `email`, `phone`, `adults` (≥1), `children` (≥0), `payment_source` (`stripe`|`etransfer`), `contribution`.

Optional: `isBvFamily`, `category` (`bv-family`|`sevak`|`non-bv`), `additionalAttendees`, `mothersInPuja`, `fid`, `etransferReference` (max 50 chars).

`registrationId` must match `/^MD26-[A-Z0-9]{7}$/`.

### Response

```json
{ "success": true, "registrationId": "MD26-ABC1234" }
```

### Error codes

| Status | Meaning |
|---|---|
| 400 | Schema validation failed |
| 404 | Feature flag off |
| 409 | `registrationId` already exists in Firestore |
| 429 | Rate limited |
| 503 | Firebase write failed and Google Sheets fallback also failed |

---

## 3. POST /api/events/lookup

**Purpose:** Retrieves a registration by `registrationId` + `email`. Falls back to Google Sheets if Firestore fails.

**Auth:** None

**Flag-gated:** Yes

### Request

```json
{ "registrationId": "MD26-ABC1234", "email": "jane@example.com" }
```

### Response

```json
{
  "registrationId": "MD26-ABC1234",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "416-555-0000",
  "adults": 2,
  "children": 1,
  "payment_source": "etransfer",
  "contribution": 30,
  "isBvFamily": true,
  "category": "bv-family",
  "additionalAttendees": 0,
  "mothersInPuja": 1,
  "fid": "42",
  "paymentStatus": "pending",
  "etransferReference": "C1AsjcyW6gqU",
  "contributionExpected": "50",
  "contributionReceived": "30"
}
```

`etransferReference`, `contributionExpected`, `contributionReceived` are empty string / `undefined` when not set.

### Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid request |
| 404 | Registration not found or email mismatch |
| 502 | Google Sheets lookup failed |

---

## 4. POST /api/events/create-checkout

**Purpose:** Proxy to the Stripe checkout Lambda. Validates pricing server-side before forwarding.

**Auth:** None (IP rate-limited, origin-validated)

**Flag-gated:** Yes

### Request

```json
{
  "lineItems": [
    { "name": "Adults", "amount": 10.00, "quantity": 2 },
    { "name": "Children", "amount": 10.00, "quantity": 1 },
    { "name": "Processing Fees", "amount": 0.96, "quantity": 1 }
  ],
  "customerEmail": "jane@example.com",
  "client_reference_id": "MD26-ABC1234",
  "successUrl": "https://portal.chinmayatoronto.org/events/register/success?session_id={CHECKOUT_SESSION_ID}",
  "cancelUrl": "https://portal.chinmayatoronto.org/events/register/cancel",
  "metadata": { "campaign": "MD26" },
  "branding_settings": { "display_name": "Chinmaya Mission Toronto" }
}
```

Valid `name` values: `Adults`, `Child`, `Children`, `BV Family`, `BV Teacher/Sevak`, `Additional Attendees`, `Processing Fees`.

Per-person amount is $10.00. Processing fee = `round((subtotal * 0.022 + 0.30) * 100) / 100`.

### Response

Proxied directly from the Stripe Lambda — contains `url` (Stripe checkout URL).

```json
{ "url": "https://checkout.stripe.com/pay/cs_live_..." }
```

### Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid schema, invalid redirect URLs, or pricing mismatch |
| 404 | Feature flag off |
| 429 | Rate limited |
| 502 | Stripe Lambda returned an error |

---

## 5. POST /api/events/update-reference

**Purpose:** Saves an e-transfer reference number to an existing registration. Requires email verification.

**Auth:** None

**Flag-gated:** Yes

### Request

```json
{
  "registrationId": "MD26-ABC1234",
  "email": "jane@example.com",
  "etransferReference": "C1AsjcyW6gqU"
}
```

### Response

```json
{ "success": true, "registrationId": "MD26-ABC1234" }
```

### Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid schema |
| 404 | Registration not found or email mismatch |
| 502 | Firebase lookup failed |

---

## 6. POST /api/events/update-payment-status

**Purpose:** Client-side Stripe success-page call. Marks a Stripe registration as `completed` in Firestore.

**Auth:** None

**Flag-gated:** Yes

### Request

```json
{
  "registrationId": "MD26-ABC1234",
  "paymentStatus": "completed",
  "payment_source": "stripe"
}
```

### Response

```json
{ "success": true, "registrationId": "MD26-ABC1234" }
```

### Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid schema or registration is not a Stripe payment |
| 404 | Registration not found or feature flag off |

---

## 7. POST /api/events/webhooks/payment-status

**Purpose:** Server-to-server webhook. Used by the Vaibhav admin tool to update payment status for any registration. Always active (not flag-gated).

**Auth:** `x-api-key` header — must match `WEBHOOK_API_KEY` env var (timing-safe comparison)

**Flag-gated:** No

### Request

```json
{
  "registrationId": "MD26-ABC1234",
  "paymentStatus": "review",
  "payment_source": "etransfer",
  "contributionExpected": "50",
  "contributionReceived": "1.00"
}
```

`paymentStatus` values: `pending`, `completed`, `failed`, `refunded`, `review`.
`payment_source` values: `stripe`, `etransfer`, `unknown` (default: `unknown`).
`contributionExpected` and `contributionReceived` are optional strings (e.g. `"50"`, `"1.00"`).

### Response

```json
{
  "success": true,
  "registrationId": "MD26-ABC1234",
  "paymentStatus": "review"
}
```

### Error codes

| Status | Meaning |
|---|---|
| 400 | Missing/invalid fields or unparseable body |
| 401 | Missing, wrong, or length-mismatched `x-api-key` |

---

## 8. POST /api/events/check-bv-status

**Purpose:** Legacy endpoint kept for backwards compatibility with the standalone `chinmaya-event-registration` app. Prefer `verify-registration` for new clients — it also includes duplicate-registration detection.

**Auth:** None (IP rate-limited)

**Flag-gated:** Yes

### Request variants (same union shape as verify-registration BV paths)

```json
{ "email": "parent@example.com" }
{ "familyId": "42" }
{ "sevakEmail": "teacher@example.com" }
```

### Response

```json
{ "isBvFamily": true, "familyEmails": ["parent@example.com"], "familyPhones": ["4165551234"] }
{ "isBvFamily": false }
{ "isSevak": true }
```

### Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid schema |
| 404 | Feature flag off |
| 429 | Rate limited |

---

## End-to-end flow example

```
1. verify-registration  →  { isBvFamily: true, fid: "42", existingRegistration: undefined }
2. register             →  { success: true, registrationId: "MD26-ABC1234" }
3a. create-checkout     →  { url: "https://checkout.stripe.com/..." }   (Stripe path)
3b. update-reference    →  { success: true, ... }                        (e-transfer path)
4. lookup               →  full registration record
5. [server] webhooks/payment-status → { success: true, paymentStatus: "completed" }
```

---

## Mobile client usage (React Native)

All endpoints accept plain `fetch` with `Content-Type: application/json`. No cookies, sessions, or browser APIs required.

### Environment

```ts
const BASE_URL = process.env.EXPO_PUBLIC_PORTAL_API_URL ?? 'https://portal.chinmayatoronto.org';
```

### Helper

```ts
async function portalPost<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw Object.assign(new Error(err.error ?? 'Request failed'), { status: res.status });
  }
  return res.json() as Promise<T>;
}
```

### Verify registration (BV family by email)

```ts
import { type VerifyRegistrationRequest } from '@cmt/shared-domain/events/api-contracts';

const result = await portalPost<{
  isBvFamily: boolean;
  fid?: string;
  familyEmails?: string[];
  familyPhones?: string[];
  existingRegistration?: { registrationId: string; paymentStatus: string };
}>('/api/events/verify-registration', { email: 'parent@example.com' } satisfies VerifyRegistrationRequest);
```

### Register

```ts
import { type RegisterRequest } from '@cmt/shared-domain/events/api-contracts';

const registration: RegisterRequest = {
  registrationId: 'MD26-ABC1234',
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '416-555-0000',
  adults: 2,
  children: 1,
  payment_source: 'etransfer',
  contribution: 30,
  category: 'bv-family',
  fid: '42',
};
const result = await portalPost<{ success: boolean; registrationId: string }>(
  '/api/events/register',
  registration,
);
```

### Lookup

```ts
const record = await portalPost<{
  registrationId: string;
  name: string;
  email: string;
  paymentStatus: string;
  etransferReference?: string;
}>('/api/events/lookup', { registrationId: 'MD26-ABC1234', email: 'jane@example.com' });
```

### Update e-transfer reference

```ts
await portalPost<{ success: boolean; registrationId: string }>(
  '/api/events/update-reference',
  { registrationId: 'MD26-ABC1234', email: 'jane@example.com', etransferReference: 'C1AsjcyW6gqU' },
);
```

### Webhook (server-side only — not for mobile clients)

```ts
await portalPost<{ success: boolean; registrationId: string; paymentStatus: string }>(
  '/api/events/webhooks/payment-status',
  { registrationId: 'MD26-ABC1234', paymentStatus: 'completed', payment_source: 'etransfer' },
  { 'x-api-key': process.env.WEBHOOK_API_KEY! },
);
```
