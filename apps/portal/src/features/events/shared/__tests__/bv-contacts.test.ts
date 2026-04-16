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
