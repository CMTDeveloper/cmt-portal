import { describe, it, expect } from 'vitest';
import type { Family, ContactInfo, PaymentStatus } from '../check-in/family';

describe('Family type', () => {
  it('accepts a valid family', () => {
    const family: Family = {
      fid: '42',
      name: 'Acme',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      paymentStatus: 'paid',
      students: [
        { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'Kindergarten' },
      ],
    };
    expect(family.fid).toBe('42');
    expect(family.students[0]?.sid).toBe('1');
  });

  it('PaymentStatus union covers paid, unpaid, partial', () => {
    const statuses: PaymentStatus[] = ['paid', 'unpaid', 'partial'];
    expect(statuses).toHaveLength(3);
  });

  it('ContactInfo discriminated union', () => {
    const email: ContactInfo = { type: 'email', value: 'a@b.com' };
    const phone: ContactInfo = { type: 'phone', value: '+16475550100' };
    expect(email.type).toBe('email');
    expect(phone.type).toBe('phone');
  });
});
