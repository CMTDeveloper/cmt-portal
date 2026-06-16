// CSV cell encoding for exports opened in Excel / Google Sheets / Numbers.
//
// Two concerns, in order:
// 1. FORMULA INJECTION: a cell whose first character is `= + - @`, TAB, or CR
//    is interpreted as a formula by spreadsheet apps, so a malicious family or
//    member name like `=HYPERLINK("http://evil","click")` or `=cmd|...` would
//    execute on open. Neutralize by prefixing a single quote, which forces the
//    cell to be treated as literal text.
// 2. CSV SYNTAX: quote when the value contains a quote, comma, or newline,
//    doubling embedded quotes.

const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? '' : String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Join a row of already-raw values into a single CSV line (each cell encoded). */
export function csvRow(cells: ReadonlyArray<unknown>): string {
  return cells.map(csvCell).join(',');
}
