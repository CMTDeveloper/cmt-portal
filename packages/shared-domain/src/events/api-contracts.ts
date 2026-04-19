import { z } from 'zod';

// --- check-bv-status (legacy — kept for backwards compat) ---

export const checkBvStatusRequestSchema = z.union([
  z.object({ familyId: z.string().min(1).max(10) }),
  z.object({ email: z.string().email() }),
  z.object({ sevakEmail: z.string().email() }),
]);
export type CheckBvStatusRequest = z.infer<typeof checkBvStatusRequestSchema>;

export const checkBvStatusResponseSchema = z.object({
  isBvFamily: z.boolean(),
  familyEmails: z.array(z.string()).optional(),
  familyPhones: z.array(z.string()).optional(),
});
export type CheckBvStatusResponse = z.infer<typeof checkBvStatusResponseSchema>;

// --- verify-registration ---

export const existingRegistrationSchema = z.object({
  registrationId: z.string(),
  paymentStatus: z.string(),
});
export type ExistingRegistrationResult = z.infer<typeof existingRegistrationSchema>;

export const verifyRegistrationRequestSchema = z.union([
  z.object({ email: z.string().email() }),
  z.object({ familyId: z.string().min(1).max(10) }),
  z.object({ sevakEmail: z.string().email() }),
  z.object({ checkDuplicateEmail: z.string().email(), category: z.enum(['non-bv']) }),
]);
export type VerifyRegistrationRequest = z.infer<typeof verifyRegistrationRequestSchema>;

export const verifyRegistrationResponseSchema = z.union([
  // BV family path (email or familyId)
  z.object({
    isBvFamily: z.literal(true),
    fid: z.string(),
    familyEmails: z.array(z.string()),
    familyPhones: z.array(z.string()),
    existingRegistration: existingRegistrationSchema.optional(),
  }),
  // Non-BV family path (not found)
  z.object({ isBvFamily: z.literal(false) }),
  // Sevak path
  z.object({
    isSevak: z.boolean(),
    existingRegistration: existingRegistrationSchema.optional(),
  }),
  // Non-BV duplicate check path
  z.object({ existingRegistration: existingRegistrationSchema.optional() }),
]);
export type VerifyRegistrationResponse = z.infer<typeof verifyRegistrationResponseSchema>;

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
  category: z.enum(['bv-family', 'sevak', 'non-bv']).optional(),
  additionalAttendees: z.number().int().min(0).max(50).optional(),
  mothersInPuja: z.number().int().min(0).max(50).optional(),
  fid: z.string().optional(),
  etransferReference: z.string().max(50).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const registerResponseSchema = z.object({
  success: z.boolean(),
  registrationId: z.string(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

// --- lookup ---

export const lookupRequestSchema = z.object({
  registrationId: z.string().min(1).max(20),
  email: z.string().email(),
});
export type LookupRequest = z.infer<typeof lookupRequestSchema>;

export const lookupResponseSchema = z.object({
  registrationId: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  adults: z.number(),
  children: z.number(),
  payment_source: z.enum(['stripe', 'etransfer']),
  contribution: z.number(),
  isBvFamily: z.boolean(),
  category: z.enum(['bv-family', 'sevak', 'non-bv']),
  additionalAttendees: z.number(),
  mothersInPuja: z.number(),
  fid: z.string(),
  paymentStatus: z.enum(['pending', 'completed', 'failed', 'refunded', 'review']),
  etransferReference: z.string(),
  contributionExpected: z.string().optional(),
  contributionReceived: z.string().optional(),
});
export type LookupResponse = z.infer<typeof lookupResponseSchema>;

// --- create-checkout ---

export const lineItemSchema = z.object({
  name: z.enum(['Adults', 'Child', 'Children', 'BV Family', 'BV Teacher/Sevak', 'Additional Attendees', 'Processing Fees']),
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

export const createCheckoutResponseSchema = z.object({
  checkoutUrl: z.string().url().optional(),
  url: z.string().url().optional(),
});
export type CreateCheckoutResponse = z.infer<typeof createCheckoutResponseSchema>;

// --- update-reference ---

export const updateReferenceRequestSchema = z.object({
  registrationId: z.string().regex(/^MD26-[A-Z0-9]{7}$/),
  email: z.string().email(),
  etransferReference: z.string().min(1).max(50),
});
export type UpdateReferenceRequest = z.infer<typeof updateReferenceRequestSchema>;

export const updateReferenceResponseSchema = z.object({
  success: z.boolean(),
  registrationId: z.string(),
});
export type UpdateReferenceResponse = z.infer<typeof updateReferenceResponseSchema>;

// --- update-payment-status (client-side, Stripe success page) ---

export const updatePaymentStatusRequestSchema = z.object({
  registrationId: z.string().regex(/^MD26-[A-Z0-9]{7}$/),
  paymentStatus: z.enum(['completed']),
  payment_source: z.enum(['stripe']),
});
export type UpdatePaymentStatusRequest = z.infer<typeof updatePaymentStatusRequestSchema>;

export const updatePaymentStatusResponseSchema = z.object({
  success: z.boolean(),
  registrationId: z.string(),
});
export type UpdatePaymentStatusResponse = z.infer<typeof updatePaymentStatusResponseSchema>;

// --- stats (admin aggregation, x-api-key protected) ---

export const statsRequestSchema = z.object({});
export type StatsRequest = z.infer<typeof statsRequestSchema>;

export const statsResponseSchema = z.object({
  campaign: z.string(),
  generatedAt: z.string(),
  totalRegistrations: z.number(),
  totalMothers: z.number(),
  totalAttendees: z.number(),
  totalContribution: z.number(),
  paid: z.object({
    mothers: z.number(),
    attendees: z.number(),
  }),
  byStatus: z.record(z.string(), z.number()),
  byCategory: z.record(z.string(), z.number()),
  byPaymentSource: z.record(z.string(), z.number()),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;

// --- webhook payment-status (server-side, Vaibhav's admin tool) ---

export const webhookPaymentStatusRequestSchema = z.object({
  registrationId: z.string().regex(/^MD26-[A-Z0-9]{7}$/),
  paymentStatus: z.enum(['pending', 'completed', 'failed', 'refunded', 'review']),
  payment_source: z.enum(['stripe', 'etransfer', 'unknown']).optional().default('unknown'),
  contributionExpected: z.string().optional(),
  contributionReceived: z.string().optional(),
});
export type WebhookPaymentStatusRequest = z.infer<typeof webhookPaymentStatusRequestSchema>;

export const webhookPaymentStatusResponseSchema = z.object({
  success: z.boolean(),
  registrationId: z.string(),
  paymentStatus: z.enum(['pending', 'completed', 'failed', 'refunded', 'review']),
});
export type WebhookPaymentStatusResponse = z.infer<typeof webhookPaymentStatusResponseSchema>;
