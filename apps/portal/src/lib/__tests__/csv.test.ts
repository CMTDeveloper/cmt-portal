import { describe, it, expect } from 'vitest';
import { csvCell, csvRow } from '../csv';

describe('csvCell — formula injection guard', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])('prefixes a cell leading with %j with a quote', (lead) => {
    expect(csvCell(`${lead}cmd`)).toBe(`'${lead}cmd`);
  });

  it('neutralizes a classic =HYPERLINK formula in a name', () => {
    // contains a comma + quotes too → must also be CSV-quoted after neutralizing
    const out = csvCell('=HYPERLINK("http://evil","x")');
    expect(out.startsWith(`"'=HYPERLINK`)).toBe(true);
    expect(out).toContain('""http://evil""'); // quotes doubled
  });

  it('leaves a normal name untouched', () => {
    expect(csvCell('Priya Patel')).toBe('Priya Patel');
  });

  it('CSV-quotes values with comma/quote/newline', () => {
    expect(csvCell('Patel, Raj')).toBe('"Patel, Raj"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('renders null/undefined/number safely', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42)).toBe('42');
  });
});

describe('csvRow', () => {
  it('encodes each cell and joins with commas', () => {
    expect(csvRow(['Priya Patel', '=2+2', 5])).toBe("Priya Patel,'=2+2,5");
  });
});
