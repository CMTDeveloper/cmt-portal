import type { PaymentSource } from './registration';

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
    ? input.pricePerPerson
    : (input.adults + input.children) * input.pricePerPerson;

  const processingFee =
    input.paymentMethod === 'stripe'
      ? Math.round((subtotal * STRIPE_PERCENT_FEE + STRIPE_FIXED_FEE) * 100) / 100
      : 0;

  const total = Math.round((subtotal + processingFee) * 100) / 100;

  return { subtotal, processingFee, total };
}
