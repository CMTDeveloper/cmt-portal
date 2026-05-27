import { describe, it, expect } from 'vitest';
import { toSafeSlug } from '../utils/slug';

describe('toSafeSlug', () => {
  it('lowercases and keeps alphanumeric and dashes', () => {
    expect(toSafeSlug('Fall 2027')).toBe('fall-2027');
  });

  it('replaces slashes with dashes (Fall/2027)', () => {
    expect(toSafeSlug('Fall/2027')).toBe('fall-2027');
  });

  it('collapses multiple separators into one dash', () => {
    expect(toSafeSlug('Fall  /  2027')).toBe('fall-2027');
  });

  it('strips leading and trailing dashes', () => {
    expect(toSafeSlug('/Fall 2027/')).toBe('fall-2027');
  });

  it('handles punctuation: ampersands, dots, parens', () => {
    expect(toSafeSlug('Spring & Summer (2028)')).toBe('spring-summer-2028');
  });

  it('returns empty string for input with no valid characters', () => {
    expect(toSafeSlug('---')).toBe('');
    expect(toSafeSlug('   ')).toBe('');
    expect(toSafeSlug('///')).toBe('');
  });

  it('handles already-slug input unchanged', () => {
    expect(toSafeSlug('bala-vihar')).toBe('bala-vihar');
  });

  it('handles uppercase location names', () => {
    expect(toSafeSlug('Brampton')).toBe('brampton');
    expect(toSafeSlug('Mississauga')).toBe('mississauga');
  });

  it('produces stable pid for the period-POST pattern', () => {
    const pid = [
      toSafeSlug('bala-vihar'),
      toSafeSlug('Brampton'),
      toSafeSlug('Fall 2027'),
    ].join('-');
    expect(pid).toBe('bala-vihar-brampton-fall-2027');
  });
});
