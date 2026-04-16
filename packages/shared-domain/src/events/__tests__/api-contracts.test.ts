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
