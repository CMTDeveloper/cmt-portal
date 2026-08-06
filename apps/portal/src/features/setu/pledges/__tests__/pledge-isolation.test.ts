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

  /**
   * The surfaces ALLOWED to depend on pledge state, and nothing else.
   *
   * ── Why this list exists at all ─────────────────────────────────────────────
   * Until 2026-07-27 the rule was absolute: "a pledge gates NOTHING". Vaibhav
   * then established that the monthly pledge is not a separate ask but the
   * SECOND way to pay the Bala Vihar enrollment donation - $500 once or $51 a
   * month - so the surfaces that report whether a family has paid now have to
   * know. The invariant could not survive unchanged; deleting it outright would
   * have thrown away the part still worth enforcing.
   *
   * So it became an allowlist. Each entry below is a place where a human decided
   * that a pledge counts. Anything NEW that reads pledge state still fails this
   * test, which is the point: the reversal was deliberate and bounded, and the
   * next one has to be deliberate too.
   *
   * ⚠️ Adding a file here is a claim that a pledge is equivalent to money
   * received. It is NOT, quite: with no Stripe webhook the portal cannot see
   * that any monthly payment after the first was collected. Every entry
   * over-reports a family who stops paying at the bank.
   */
  const MAY_READ_PLEDGE_STATE = [
    // The family's own dashboard: donation complete/percent + Enrolled state.
    join('app', 'family', '_helpers', 'dashboard-model.ts'),
    // The #23 rule itself - "attended, or donated, or pledged".
    join('app', 'family', '_helpers', 'enrollment-confirmation.ts'),
    // Reads THIS family's pledge to feed the model.
    join('app', 'family', '_helpers', 'load-dashboard.ts'),
    // Teacher roster: a pledging family is confirmed, not left unpaid.
    join('features', 'setu', 'teacher', 'roster-confirmation.ts'),
    // Enrollment report / CSV headcounts.
    join('features', 'setu', 'reports', 'enrollment-report.ts'),
    // /welcome/roster's ONLY data source - the screen welcome-team works from.
    join('features', 'setu', 'roster', 'report-dataset.ts'),
    // The enrollment report's CSV half.
    join('features', 'setu', 'roster', 'build-csv-rows.ts'),
    // 🔴 `deriveFamilyPayment` - the single-family verdict. TWO reasons, and the
    // second is the refusing kind:
    //   1. It reports money received, like report-dataset.ts does for the
    //      roster chip. Without the pledge it would call every monthly-plan
    //      family 'outstanding' forever, because a live plan writes no
    //      completed donation docs (there is no Stripe webhook, #54/#64) - so
    //      the family-detail screen would contradict the roster it was opened
    //      from.
    //   2. It gates the off-portal settlement at
    //      api/welcome/enrollments/[eid]/override. A pledging family's money is
    //      already arriving by pre-authorized debit; recording an off-portal
    //      settlement on top claims CMT collected it twice, and Undo does not
    //      take it back. Added 2026-08-05 after review caught the first draft
    //      leaving that write open for the whole pledge population.
    join('features', 'setu', 'roster', 'payment.ts'),
    // The welcome-desk payment panels. Note what this entry is NOT: it makes no
    // payment DECISION at all - `payment.ts` above already decided, and this
    // file renders what it was handed. It appears here only because it names
    // `StaffPledgeView` to type its props.
    //
    // It is nonetheless the right thing to allowlist rather than to type around,
    // because it does display pledge state: status, the monthly amount, the
    // dates, and the payment service's own error text. Erasing the type to slip
    // past this guard would hide a real surface, which is the failure this
    // quarantine exists to prevent. Added 2026-08-06 with the payment view.
    join('features', 'setu', 'roster', 'components', 'family-payment-panels.tsx'),
    // 🔴 The double-charge guard. This entry is NOT the usual "a pledge counts
    // as paid" claim the warning above describes - it is the opposite, and the
    // only entry that REFUSES money rather than reporting it received. A family
    // with a `started` or `active` pledge cannot also be charged the one-time
    // Bala Vihar amount, because both would be debited and the portal cannot
    // undo either. Added 2026-07-28 after `/family/donate?eid=` was found
    // rendering the full payment form with no pledge awareness at all.
    join('app', 'api', 'setu', 'donations', 'checkout', 'route.ts'),
    // Feeds the adult-class gate. A pledging family has PAID the Bala Vihar
    // donation, so they owe the adult-class selection like any other donor -
    // without this they were never asked at all. Added 2026-07-28.
    join('features', 'setu', 'adult-class', 'load-gate-data.ts'),
    // 🔴 The "you still owe the Bala Vihar donation" letter. Like the
    // double-charge guard above, this entry exists to REFUSE an action rather
    // than to report money received: a family on a live monthly pledge owes
    // nothing further, so ignoring pledge state here would send them a letter
    // saying their enrollment is not confirmed while their bank is debited
    // every month. It is the single decision point for both triggers of
    // `bv_enrolled_donation_pending` (backing out of Stripe, and the door), so
    // one entry covers both. Added 2026-07-30.
    join('features', 'setu', 'donations', 'bv-unpaid.ts'),
  ];

  /**
   * Surfaces that MUST consider a pledge, and would be WRONG to ignore one.
   *
   * ── Why this exists, and why the allowlist above was not enough ────────────
   * The allowlist catches an ADDITION - a new file that reads pledge state
   * without permission. The bug that actually shipped was an OMISSION: two
   * existing surfaces that decide whether a family has paid were never updated,
   * and because they mention nothing pledge-related they were invisible to
   * every check here. `/welcome/roster` showed a pledging family as
   * "Registered"/"outstanding" permanently, and `GET
   * /api/welcome/reports/enrollment` answered "paid" as JSON and "outstanding"
   * as CSV - the same report, the same screen, two answers.
   *
   * No allowlist could have caught that, because absence has no fingerprint. So
   * this is the mirror: name the surfaces that report payment, and fail if one
   * stops consulting pledges. Adding a NEW payment-reporting surface still
   * requires a human to add it here - but the ones we know about can no longer
   * silently drift apart.
   */
  const MUST_CONSIDER_PLEDGE = [
    // 🔴 The third omission of exactly this kind, reported by CMT Developer on
    // 2026-07-28: `isBalaViharPaid` recognised a donation record, a legacy row
    // and a teacher-managed offering - but not a pledge. A family who enrolled
    // and paid MONTHLY was therefore never shown the adult-class step. This list
    // exists to catch precisely that, and missed it only because it is
    // hand-enumerated and nobody had added the file.
    join('features', 'setu', 'adult-class', 'needs-selection.ts'),
    join('app', 'family', '_helpers', 'dashboard-model.ts'),
    join('features', 'setu', 'teacher', 'roster-confirmation.ts'),
    join('features', 'setu', 'reports', 'enrollment-report.ts'),
    join('features', 'setu', 'roster', 'report-dataset.ts'),
    join('features', 'setu', 'roster', 'build-csv-rows.ts'),
  ];

  it('every surface that reports whether a family has PAID consults the pledge', () => {
    for (const required of MUST_CONSIDER_PLEDGE) {
      const file = FILES.find((f) => f.rel.endsWith(required));
      expect(file, `a payment-reporting surface vanished: ${required}`).toBeDefined();
      expect(
        /(loadActivePledgeFids|hasActivePledge|isPledgeGiving|pledgedFids)/.test(file!.body),
        `${required} decides whether a family has paid but never consults their monthly ` +
          `pledge - it will disagree with every other surface the moment a family pledges`,
      ).toBe(true);
    }
  });

  it('is consulted ONLY by the surfaces explicitly allowed to treat a pledge as payment', () => {
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
        !MAY_READ_PLEDGE_STATE.some((allowed) => f.rel.endsWith(allowed)) &&
        /(features\/setu\/pledges|isPledgeGiving|PledgeStatus|PledgeDoc)/.test(f.body),
    ).map((f) => f.rel);
    expect(
      offenders,
      'a NEW decision surface depends on pledge state - if that is intended, add it to ' +
        'MAY_READ_PLEDGE_STATE above and say why a pledge counts as payment there',
    ).toEqual([]);
  });

  it('every allowlisted file exists and actually reads pledge state', () => {
    // Guards the allowlist itself. A stale entry - a file renamed, or one that
    // stopped reading pledges - would silently widen the exemption, so that the
    // NEXT file to take that path would be waved through by an entry nobody
    // remembers granting.
    for (const allowed of MAY_READ_PLEDGE_STATE) {
      const file = FILES.find((f) => f.rel.endsWith(allowed));
      expect(file, `allowlisted file no longer exists: ${allowed}`).toBeDefined();
      expect(
        /(features\/setu\/pledges|isPledgeGiving|PledgeStatus|PledgeDoc|hasActivePledge)/.test(file!.body),
        `${allowed} is allowlisted but no longer reads pledge state - remove it from the allowlist`,
      ).toBe(true);
    }
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

    // NARROWED 2026-07-27, deliberately, and worth reading before widening it
    // back. This used to fail on ANY mention of "pledge" in a CSV builder. Since
    // the monthly plan became a way to PAY the Bala Vihar donation, the CSV's
    // existing `payment` column must consult it - a plan-payer reads 'paid',
    // the identical value someone who paid $500 at once gets. That is not a
    // leak: the column cannot distinguish them, so it reveals nothing about how
    // a family pays.
    //
    // What must never appear is a pledge-SPECIFIC field: the amount, the
    // status, or any Stripe handle. Those would tell every reader of an exported
    // spreadsheet that this family is on an instalment plan - which is the
    // family's business, and a CSV is the one artifact that leaves the building.
    const LEAKY = /monthlyAmountCAD|subscriptionId|customerId|setupSessionId|PledgeStatus|PledgeDoc|pledgeStatus/;
    const offenders = csvFiles.filter((f) => LEAKY.test(f.body)).map((f) => f.rel);
    expect(
      offenders,
      'a CSV builder now emits a pledge-specific field - an exported spreadsheet would ' +
        'reveal which families pay by instalment',
    ).toEqual([]);
  });
});
