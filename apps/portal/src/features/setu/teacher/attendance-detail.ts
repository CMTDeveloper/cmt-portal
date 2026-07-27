import 'server-only';
import type { RosterPayment } from '@cmt/shared-domain/setu';
import type { OfferingDoc } from '@cmt/shared-domain/setu';
import { classifyBulkPayment } from '@/features/setu/roster/payment';

/**
 * Parent contact + payment verdict for ONE level's families (spec §4.4).
 *
 * ── Why `payment` is four states and not `donationComplete: boolean` ──────────
 * The plan specified a boolean. It cannot carry the model this repo actually
 * uses: `classifyRosterPayment` returns `paid | outstanding | not-applicable |
 * unknown`, and the two extra states exist because a zero balance means either
 * "no fee applies" or "we never found a price" and those must not read the same
 * (owner decision 2026-07-26, runbook §14). Flattening them into `false` would
 * tell a teacher a family owes money when we either know they owe nothing or
 * cannot tell.
 *
 * The verdict is computed honestly here; the ROW renders a chip only for `paid`
 * and `outstanding` (owner: "really what a teacher should see is Paid or
 * Outstanding"). Showing nothing for the other two is the honest rendering of
 * "no opinion" - it is not the same as showing "Outstanding".
 *
 * ── Scope: this class's enrollment, not the family's whole balance ────────────
 * `enrMeta` is the level's own program period, so the verdict answers "has this
 * family settled up for THIS class" - which is the question a teacher taking
 * Bala Vihar attendance has. It is deliberately NOT the welcome desk's
 * whole-family verdict: `paidCAD` is family-wide, so a family enrolled in a
 * second program can read `paid` here while the desk reads `outstanding`.
 * Making the two agree would need every active enrollment per family, i.e. a new
 * `enrollments.fid` collection-group index and an extra query on a page every
 * teacher loads every Sunday. Recorded rather than silently accepted.
 *
 * ── Read budget: three batched reads, no fan-out, no new index ────────────────
 * Donations are chunked `in` queries on the top-level `donations` collection
 * (it carries an `fid` FIELD - the bug Task 1 fixed was reading it from the
 * parent path). Offerings and the manager member docs are single batched
 * `getAll`s. Nothing here loops a query per family: `roster-fetch.test.ts:126`
 * guards that property for `deriveRoster` and the same rule applies to this
 * module, in the same request.
 */
export interface AttendanceDetail {
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  payment: RosterPayment;
}

/** One family's active enrollment for this level's period, as `deriveRoster` holds it. */
export interface AttendanceEnrollmentMeta {
  oid: string;
  enrolledAt: Date;
  suggestedAmountOverride: number | null;
  suggestedAmountSnapshot: number | null;
}

/** Firestore's `in` cap. HARD: an over-long array throws INVALID_ARGUMENT
 *  rather than degrading, so the chunker is correctness, not tuning. */
const IN_CHUNK = 30;

/**
 * Guard against being handed `deriveRoster`'s own `fids`, which is
 * PROGRAM-and-location scoped (`roster.ts:135-139` filters `pid` + `status`,
 * `:147` filters location) rather than level scoped. Measured 2026-07-26: the
 * largest UAT level holds 8 families and prod has ~869 families over ~15 levels,
 * so a real class is far below this and a program-scoped set at prod (~500 for
 * Brampton alone) is far above it. Set well clear of both rather than at the
 * plan's 80, which a single large class could legitimately exceed - a cap that
 * throws on real data would 500 the teacher screen on a Sunday morning.
 */
const MAX_DETAIL_FIDS = 150;

function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

export async function buildAttendanceDetailIndex(
  db: FirebaseFirestore.Firestore,
  /** LEVEL-scoped fids, derived from `roster.members`. NOT `deriveRoster`'s `fids`. */
  fids: readonly string[],
  enrMeta: ReadonlyMap<string, AttendanceEnrollmentMeta>,
  /** fid → the family's first manager mid, from the family docs deriveRoster already read. */
  managerMidByFid: ReadonlyMap<string, string | null>,
): Promise<Map<string, AttendanceDetail>> {
  const out = new Map<string, AttendanceDetail>();
  if (fids.length === 0) return out;

  if (fids.length > MAX_DETAIL_FIDS) {
    throw new Error(
      `buildAttendanceDetailIndex got ${fids.length} fids. Expected a LEVEL-scoped set. ` +
        `deriveRoster's own \`fids\` is program-and-location scoped - derive from roster.members instead.`,
    );
  }

  // Manager member docs, addressed directly by mid. One batched getAll, not a
  // members-subcollection read per family: member doc id === mid is the
  // universal write convention, which is what makes this addressable at all.
  const managerRefs = fids
    .map((fid) => ({ fid, mid: managerMidByFid.get(fid) ?? null }))
    .filter((x): x is { fid: string; mid: string } => x.mid !== null)
    .map(({ fid, mid }) => ({ fid, ref: db.collection('families').doc(fid).collection('members').doc(mid) }));

  // Derived from `fids`, NOT from `enrMeta.values()`. `enrMeta` is a lookup
  // table, not a work list: callers pass `deriveRoster`'s map, which is
  // program-and-location scoped, so reading its values would batch-read offering
  // docs for the whole period. `MAX_DETAIL_FIDS` guards `fids.length` and would
  // not catch that.
  const oids = [...new Set(fids.map((fid) => enrMeta.get(fid)?.oid).filter((o): o is string => !!o))];

  const [donSnaps, offDocs, managerDocs] = await Promise.all([
    Promise.all(
      chunk(fids, IN_CHUNK).map((c) => db.collection('donations').where('fid', 'in', c).get()),
    ),
    oids.length > 0 ? db.getAll(...oids.map((oid) => db.collection('offerings').doc(oid))) : Promise.resolve([]),
    managerRefs.length > 0
      ? db.getAll(...managerRefs.map((m) => m.ref))
      : Promise.resolve([]),
  ]);

  // Completed donations only, summed per family. Filtered in memory on purpose:
  // a second `where` would need a composite index this module otherwise avoids.
  const paidByFid = new Map<string, number>();
  for (const snap of donSnaps) {
    for (const d of snap.docs) {
      const x = d.data() as { fid?: unknown; amountCAD?: unknown; status?: unknown };
      if (x.status !== 'completed') continue;
      const fid = typeof x.fid === 'string' ? x.fid : d.ref.parent.parent?.id;
      if (!fid) continue;
      const amt = typeof x.amountCAD === 'number' ? x.amountCAD : 0;
      paidByFid.set(fid, (paidByFid.get(fid) ?? 0) + amt);
    }
  }

  const offerings = new Map<string, Pick<OfferingDoc, 'pricingTiers' | 'paymentSource'>>();
  for (const d of offDocs) {
    if (!d.exists) continue;
    offerings.set(d.id, d.data() as Pick<OfferingDoc, 'pricingTiers' | 'paymentSource'>);
  }

  const contactByFid = new Map<string, { name: string | null; email: string | null; phone: string | null }>();
  managerDocs.forEach((d, i) => {
    const fid = managerRefs[i]!.fid;
    if (!d.exists) return;
    const m = d.data() as { firstName?: unknown; lastName?: unknown; email?: unknown; phone?: unknown; type?: unknown };
    // `family.managers` is NOT type-guarded on the write path: `write-member.ts:602`
    // pushes any mid whose PATCH carries `manager: true`, with no `type === 'Adult'`
    // check, so a Child can end up as `managers[0]`. Showing a child's own
    // details to a teacher labelled "parent contact" is worse than showing
    // nothing, so a non-Adult manager resolves to no contact at all.
    // `student-detail.ts:65` filters on type for the same reason.
    if (m.type !== 'Adult') return;
    const name = [str(m.firstName), str(m.lastName)].filter(Boolean).join(' ').trim();
    contactByFid.set(fid, {
      name: name === '' ? null : name,
      email: str(m.email),
      phone: str(m.phone),
    });
  });

  for (const fid of fids) {
    const contact = contactByFid.get(fid);
    const enr = enrMeta.get(fid);
    // No active enrollment for this level's period → no basis for a verdict.
    // `classifyBulkPayment([])` already answers `unknown`; passing the empty
    // array rather than short-circuiting keeps that one definition.
    //
    // An UNPARSEABLE `enrolledAt` takes the same door, and that is a crash guard,
    // not tidiness: `resolveSuggestedAmount` formats the date with
    // `Intl.DateTimeFormat`, which THROWS `RangeError: Invalid time value` on an
    // invalid Date rather than returning something odd. An enrollment doc with a
    // missing or malformed `enrolledAt` would take down the whole attendance page
    // on a Sunday morning. No such doc exists in UAT today (0 of 687, checked
    // 2026-07-26), but `rawToEnrollment` casts Firestore data without parsing it,
    // so nothing prevents one. "We cannot tell" is the honest verdict for it.
    const usable = enr !== undefined && !Number.isNaN(enr.enrolledAt.getTime());
    const active = usable
      ? [{
          oid: enr!.oid,
          override: enr!.suggestedAmountOverride,
          snapshot: enr!.suggestedAmountSnapshot ?? 0,
          enrolledAt: enr!.enrolledAt,
        }]
      : [];
    out.set(fid, {
      parentName: contact?.name ?? null,
      parentPhone: contact?.phone ?? null,
      parentEmail: contact?.email ?? null,
      payment: classifyBulkPayment(active, offerings, paidByFid.get(fid) ?? 0),
    });
  }

  return out;
}
