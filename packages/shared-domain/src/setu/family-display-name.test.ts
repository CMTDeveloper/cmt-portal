import { describe, it, expect } from 'vitest';
import { formatFamilyParentNames, type ParentNameMember } from './family-display-name';

function m(over: Partial<ParentNameMember>): ParentNameMember {
  return { firstName: 'A', lastName: 'B', type: 'Adult', ...over };
}

describe('formatFamilyParentNames', () => {
  it('one adult -> First Last', () => {
    expect(formatFamilyParentNames([m({ firstName: 'Vaibhav', lastName: 'Rana' })], 'Rana family')).toBe('Vaibhav Rana');
  });

  it('two adults, same last name -> collapsed', () => {
    const out = formatFamilyParentNames([
      m({ firstName: 'Vaibhav', lastName: 'Rana' }),
      m({ firstName: 'Noopur', lastName: 'Rana' }),
    ], 'Rana family');
    expect(out).toBe('Vaibhav & Noopur Rana');
  });

  it('two adults, different last names -> full names joined', () => {
    const out = formatFamilyParentNames([
      m({ firstName: 'Vaibhav', lastName: 'Rana' }),
      m({ firstName: 'Priya', lastName: 'Shah' }),
    ], 'Rana family');
    expect(out).toBe('Vaibhav Rana & Priya Shah');
  });

  it('manager is listed first regardless of input order', () => {
    const out = formatFamilyParentNames([
      m({ firstName: 'Noopur', lastName: 'Rana', manager: false }),
      m({ firstName: 'Vaibhav', lastName: 'Rana', manager: true }),
    ], 'Rana family');
    expect(out).toBe('Vaibhav & Noopur Rana');
  });

  it('children are ignored', () => {
    const out = formatFamilyParentNames([
      m({ firstName: 'Vaibhav', lastName: 'Rana', type: 'Adult' }),
      m({ firstName: 'Harshita', lastName: 'Rana', type: 'Child' }),
    ], 'Rana family');
    expect(out).toBe('Vaibhav Rana');
  });

  it('no adult -> fallback', () => {
    expect(formatFamilyParentNames([m({ type: 'Child', firstName: 'Kid', lastName: 'Rana' })], 'Rana family')).toBe('Rana family');
    expect(formatFamilyParentNames([], 'Rana family')).toBe('Rana family');
  });

  it('adult with blank names is skipped; all-blank -> fallback', () => {
    expect(formatFamilyParentNames([m({ firstName: '', lastName: '', type: 'Adult' })], 'Rana family')).toBe('Rana family');
    // one real adult + one blank adult -> just the real one
    expect(formatFamilyParentNames([
      m({ firstName: '', lastName: '', type: 'Adult' }),
      m({ firstName: 'Vaibhav', lastName: 'Rana', type: 'Adult' }),
    ], 'Rana family')).toBe('Vaibhav Rana');
  });

  it('adult with only a first name -> just the first name', () => {
    expect(formatFamilyParentNames([m({ firstName: 'Vaibhav', lastName: '', type: 'Adult' })], 'x')).toBe('Vaibhav');
  });
});
