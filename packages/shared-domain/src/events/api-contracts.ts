import { z } from 'zod';

// --- check-bv-status ---

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
