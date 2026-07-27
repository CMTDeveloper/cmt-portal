import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two of P5's global constraints, made executable.
 *
 * > **A pledge gates NOTHING.** It must never affect enrollment, the payment
 * > chip, roster status, reports, or the Bala Vihar donation.
 * > **The portal never sees a bank detail.** No field, no log, no Sentry event,
 * > no email.
 *
 * The plan verifies both by walking UAT, which needs the flag flipped on - and
 * the flag stays OFF at launch, so that walk cannot happen before ship. Both
 * claims are structural, though, so they can be checked here instead: one is
 * "who reads this collection" and the other is "does this word appear anywhere".
 * A comment would not have survived the next feature; this fails the build.
 */

const SRC = join(__dirname, '../../../..');
const PLEDGE_FEATURE = join('features', 'setu', 'pledges');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !p.includes('__tests__')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({ path, rel: path.slice(SRC.length + 1), body: readFileSync(path, 'utf8') }));

/** Block and line comments out; `[^:]` so `https://` survives. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the pledge feature is quarantined', () => {
  it('found a source tree to scan at all', () => {
    // Guards the guard. If the walk returned nothing, every assertion below
    // would pass vacuously and prove precisely nothing.
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => f.rel.includes(PLEDGE_FEATURE))).toBe(true);
  });

  it('is the ONLY thing that reads the pledges collection', () => {
    const readers = FILES.filter((f) => /collection(Group)?\(['"]pledges['"]\)/.test(f.body))
      .map((f) => f.rel)
      .filter((rel) => !rel.includes(PLEDGE_FEATURE));
    // A reader outside this feature is how "a pledge gates nothing" would quietly
    // stop being true - e.g. a report that counts pledged families, or a roster
    // chip that treats a pledge as payment.
    expect(readers, 'something outside features/setu/pledges reads the pledges collection').toEqual([]);
  });

  it('is not consulted by anything that decides enrollment, payment, roster, attendance or reports', () => {
    const DECIDERS = [
      join('features', 'setu', 'enrollment'),
      join('features', 'setu', 'roster'),
      join('features', 'setu', 'teacher'),
      join('features', 'setu', 'donations'),
      join('features', 'setu', 'attendance'),
      join('features', 'setu', 'reports'),
      join('features', 'check-in'),
      join('app', 'family', '_helpers'),
    ];
    const offenders = FILES.filter(
      (f) =>
        DECIDERS.some((d) => f.rel.includes(d)) &&
        /(features\/setu\/pledges|isPledgeGiving|PledgeStatus|PledgeDoc)/.test(f.body),
    ).map((f) => f.rel);
    expect(offenders, 'a decision surface now depends on pledge state').toEqual([]);
  });

  it('never names a bank detail in CODE anywhere in the feature', () => {
    // The authorisation happens entirely on a Stripe-hosted page; the portal
    // stores status and opaque handles. If one of these words ever appears as an
    // identifier here, the architecture changed and this test should be the
    // thing that says so - before a field, a log line, or a Sentry event carries
    // one to disk.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not a loophole - it is the
    // difference between the test doing what it says and doing something else.
    // Two files describe the ABSENCE of these things in prose ("no account
    // number, transit number or institution number is ever sent"). Matching
    // those would make this test fire on documentation that is telling the truth
    // - a false positive that would eventually be silenced by deleting the
    // comment, which is the worst possible outcome.
    const BANKISH = /\b(iban|routing[_\s-]?number|transit[_\s-]?number|institution[_\s-]?number|sort[_\s-]?code|account[_\s-]?number|bank[_\s-]?account|void(ed)?[_\s-]?che(que|ck))\b/i;
    const code = FILES.filter((f) => f.rel.includes(PLEDGE_FEATURE)).map((f) => ({
      rel: f.rel,
      body: stripComments(f.body),
    }));
    // Guard the guard: if the stripper ate the source, this would pass vacuously.
    expect(code.some((f) => /export (async )?function|export const/.test(f.body))).toBe(true);
    expect(
      code.filter((f) => BANKISH.test(f.body)).map((f) => f.rel),
      'a bank-detail field name appeared in pledge CODE',
    ).toEqual([]);
  });

  it('never puts a pledge amount or status on a roster or report CSV', () => {
    // The CSV builders are the surface most likely to grow a column by accident,
    // and a CSV is the one artifact that leaves the building.
    const csvFiles = FILES.filter((f) => /csv/i.test(f.rel) && !f.rel.includes(PLEDGE_FEATURE));
    expect(csvFiles.length).toBeGreaterThan(0);
    const offenders = csvFiles.filter((f) => /pledge/i.test(f.body)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
