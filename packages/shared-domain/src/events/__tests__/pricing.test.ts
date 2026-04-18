import { describe, it, expect } from 'vitest';
import { calculatePricing } from '../pricing';

describe('calculatePricing', () => {
  // --- Non-BV pricing ($10 per person) ---

  it('calculates Non-BV etransfer: 1 adult, 0 children', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 1,
      children: 0,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(10);
  });

  it('calculates Non-BV etransfer: 2 adults, 1 child', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 2,
      children: 1,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(30);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(30);
  });

  it('calculates Non-BV stripe: 2 adults, 1 child with processing fee', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 2,
      children: 1,
      additionalAttendees: 0,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(30);
    expect(result.processingFee).toBe(0.96);
    expect(result.total).toBe(30.96);
  });

  it('calculates Non-BV stripe: 1 adult, 0 children with processing fee', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 1,
      children: 0,
      additionalAttendees: 0,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0.52);
    expect(result.total).toBe(10.52);
  });

  it('calculates Non-BV etransfer: 5 adults, 5 children', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 5,
      children: 5,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(100);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(100);
  });

  it('Non-BV ignores additionalAttendees', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 2,
      children: 0,
      additionalAttendees: 5,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(20);
  });

  // --- BV Family pricing ($10 flat + $10/additional) ---

  it('calculates BV Family flat donation with no additional attendees', () => {
    const result = calculatePricing({
      category: 'bv-family',
      adults: 2,
      children: 3,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(10);
  });

  it('calculates BV Family with 2 additional attendees', () => {
    const result = calculatePricing({
      category: 'bv-family',
      adults: 2,
      children: 0,
      additionalAttendees: 2,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(30);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(30);
  });

  it('calculates BV Family stripe with processing fee on $10 flat', () => {
    const result = calculatePricing({
      category: 'bv-family',
      adults: 2,
      children: 3,
      additionalAttendees: 0,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0.52);
    expect(result.total).toBe(10.52);
  });

  it('BV Family flat donation ignores adults/children counts', () => {
    const one = calculatePricing({
      category: 'bv-family',
      adults: 1,
      children: 0,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    const ten = calculatePricing({
      category: 'bv-family',
      adults: 5,
      children: 5,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(one.subtotal).toBe(ten.subtotal);
    expect(one.total).toBe(ten.total);
  });

  // --- Sevak pricing ($10 flat + $10/additional) ---

  it('calculates Sevak flat donation with no additional attendees', () => {
    const result = calculatePricing({
      category: 'sevak',
      adults: 1,
      children: 0,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(10);
  });

  it('calculates Sevak with 3 additional attendees', () => {
    const result = calculatePricing({
      category: 'sevak',
      adults: 2,
      children: 0,
      additionalAttendees: 3,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(40);
    expect(result.processingFee).toBe(0);
    expect(result.total).toBe(40);
  });

  it('calculates Sevak stripe with processing fee', () => {
    const result = calculatePricing({
      category: 'sevak',
      adults: 2,
      children: 0,
      additionalAttendees: 0,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(10);
    expect(result.processingFee).toBe(0.52);
    expect(result.total).toBe(10.52);
  });

  // --- Custom price per person ---

  it('uses custom pricePerPerson for non-BV', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 2,
      children: 0,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 25,
    });
    expect(result.subtotal).toBe(50);
    expect(result.total).toBe(50);
  });

  it('BV flat donation equals pricePerPerson regardless of attendee count', () => {
    const result = calculatePricing({
      category: 'bv-family',
      adults: 4,
      children: 2,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 25,
    });
    expect(result.subtotal).toBe(25);
    expect(result.total).toBe(25);
  });

  // --- Edge cases ---

  it('returns 0 total for 0 adults, 0 children, non-BV', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 0,
      children: 0,
      additionalAttendees: 0,
      paymentMethod: 'etransfer',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
  });

  it('stripe fee on $0 is just the fixed fee', () => {
    const result = calculatePricing({
      category: 'non-bv',
      adults: 0,
      children: 0,
      additionalAttendees: 0,
      paymentMethod: 'stripe',
      pricePerPerson: 10,
    });
    expect(result.subtotal).toBe(0);
    expect(result.processingFee).toBe(0.3);
    expect(result.total).toBe(0.3);
  });
});
