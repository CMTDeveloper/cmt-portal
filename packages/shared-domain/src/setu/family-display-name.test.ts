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

// Real UAT legacy data is messy; these mirror actual families found on 2026-07-13.
describe('formatFamilyParentNames - messy legacy data', () => {
  it('garbage last name on the manager loses to a clean duplicate (Surendra & Rovita Nawbatt)', () => {
    // Family "Surendra & Rovita Nawbatt" migrated as: manager first="Surendra"
    // last="& Rovita", plus clean "Surendra Nawbatt" + "Rovita Nawbatt".
    const out = formatFamilyParentNames([
      m({ firstName: 'Surendra', lastName: '& Rovita', manager: true }),
      m({ firstName: 'Surendra', lastName: 'Nawbatt' }),
      m({ firstName: 'Rovita', lastName: 'Nawbatt' }),
    ], '& Rovita family');
    expect(out).toBe('Surendra & Rovita Nawbatt');
  });

  it('exact duplicate adults are collapsed', () => {
    const out = formatFamilyParentNames([
      m({ firstName: 'Deepika', lastName: 'Tayl', manager: true }),
      m({ firstName: 'Deepika', lastName: 'Tayl' }),
      m({ firstName: 'Kapil', lastName: 'tayl' }),
    ], 'Tayl family');
    // dedupe Deepika, cap at two (manager first), case-insensitive shared surname.
    expect(out).toBe('Deepika & Kapil Tayl');
  });

  it('three real adults are capped at two parents (manager first)', () => {
    const out = formatFamilyParentNames([
      m({ firstName: 'Amol', lastName: 'Deshpande', manager: true }),
      m({ firstName: 'Gayatri', lastName: 'Deshpande' }),
      m({ firstName: 'Pranav', lastName: 'Deshpande' }),
    ], 'Deshpande family');
    expect(out).toBe('Amol & Gayatri Deshpande');
  });

  it('case-only surname differences still collapse', () => {
    const out = formatFamilyParentNames([
      m({ firstName: 'Kapil', lastName: 'Tayl', manager: true }),
      m({ firstName: 'Sara', lastName: 'tayl' }),
    ], 'x');
    expect(out).toBe('Kapil & Sara Tayl');
  });
});
