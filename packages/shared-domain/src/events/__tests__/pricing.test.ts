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
