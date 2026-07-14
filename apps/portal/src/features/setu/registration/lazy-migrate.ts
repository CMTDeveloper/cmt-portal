import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';
import { generateFid } from './generate-fid';
import { allocateMemberPublicIds } from '@/features/setu/ids/public-id-allocator';
import {
  fetchLegacyFamilyForMigration,
  type LegacyFamilyForMigration,
} from './legacy-parser';

export interface LazyMigrateResult {
  migrated: boolean;
  fid: string;
  legacyFid: string;
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

function searchKeysFor(legacy: LegacyFamilyForMigration, fid: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  function add(v: string | null | undefined) {
    if (!v) return;
    const lower = v.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(lower);
  }
  add(legacy.familyName);
  add(legacy.primaryLastName);
  add(legacy.primaryFirstName);
  for (const a of legacy.adults) add(`${a.firstName} ${a.lastName}`.trim());
  for (const c of legacy.children) add(`${c.firstName} ${c.lastName}`.trim());
  add(fid);
  add(legacy.legacyFid);
  return out;
}

export async function lazyMigrateLegacyFamily(legacyFid: string): Promise<LazyMigrateResult> {
  const legacy = await fetchLegacyFamilyForMigration(legacyFid);
  if (!legacy) {
    throw new Error(`Legacy family not found: fid=${legacyFid}`);
  }

  const db = portalFirestore();

  // Pre-transaction existence read. The common re-entry path is an
  // already-migrated family whose contact resolves via the legacy roster but
  // lacks a Setu contactKey (repeat sign-ins). For those we must allocate
  // NOTHING — the FID space is bounded (~9000 values, 1001–9999) and the
  // member-id counter is likewise finite, so burning a publicFid + an N-sized
  // publicMid block on every no-op re-entry would permanently erode the
  // memorable, roughly-sequential-from-1001 numbering while writing no docs.
  // This mirrors the in-txn guard's identity check below EXACTLY
  // (families where legacyFid == legacyFid, limit 1) so the two never disagree.
  const preExistingSnap = await db
    .collection('families')
    .where('legacyFid', '==', legacyFid)
    .limit(1)
    .get();
  if (!preExistingSnap.empty) {
    const preExistingDoc = preExistingSnap.docs[0];
    if (!preExistingDoc) throw new Error('Unexpected empty docs array after non-empty check');
    const preExistingData = preExistingDoc.data() as { fid: string };
    return { migrated: false, fid: preExistingData.fid, legacyFid };
  }

  // The user-facing publicFid is minted lazily at the family's first enrollment
  // (enrollFamily), NOT at migration. Allocate the contiguous block of 5-digit
  // publicMids — one per member doc this migration will create, in the SAME order
  // the txn writes them: adults first (or, when there are no adult rows, a single
  // synthesized manager), then children. These MUST run BEFORE db.runTransaction
  // opens — the allocator runs its own Firestore transaction and Firestore forbids
  // nested transactions. A `publicMidCursor` consumes the block in lockstep with
  // `seq` so each member doc gets the next id (members are 1:1 with the block).
  // Allocation happens AFTER the pre-txn existence read so a no-op re-entry
  // burns no ids.
  const memberCount = (legacy.adults.length || 1) + legacy.children.length;
  const publicMids = await allocateMemberPublicIds(memberCount);

  const result = await db.runTransaction(async (txn) => {
    // Race-safe guard kept intact: between the pre-txn read above and this
    // transaction another concurrent first-migration could have written the
    // family doc (a rare TOCTOU). The in-txn re-check prevents a double-write.
    const existingSnap = await txn.get(
      db.collection('families').where('legacyFid', '==', legacyFid).limit(1),
    );

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      if (!existingDoc) throw new Error('Unexpected empty docs array after non-empty check');
      const existingData = existingDoc.data() as { fid: string };
      return { migrated: false, fid: existingData.fid, legacyFid };
    }

    const fid = generateFid();
    const now = FieldValue.serverTimestamp();
    let seq = 1;
    // Consumes the pre-allocated publicMids block (sized memberCount) in the exact
    // order members are written below; each member doc gets the next id.
    let publicMidCursor = 0;
    const managerIds: string[] = [];
    const memberMids: string[] = [];

    // Adults — the primary (sorted to position 0 by the parser) is the manager.
    // Other adult rows become non-manager Adult members so spouses/parents who
    // were in legacy don't silently disappear.
    for (const adult of legacy.adults) {
      const mid = `${fid}-${zeroPad(seq++)}`;
      memberMids.push(mid);
      const isManager = adult.isPrimary;
      if (isManager) managerIds.push(mid);

      txn.set(db.collection('families').doc(fid).collection('members').doc(mid), {
        mid,
        publicMid: publicMids[publicMidCursor++]!,
        uid: null,
        firstName: adult.firstName || legacy.primaryFirstName,
        lastName: adult.lastName || legacy.primaryLastName,
        type: 'Adult',
        gender: adult.gender,
        manager: isManager,
        joinedAt: now,
        email: adult.email,
        phone: adult.phone,
        // Non-primary (roster-origin) adults are gated out of portal access
        // until a manager approves their join-request. The primary manager
        // stays active (portalAccess absent ⇒ active). Children never get
        // portalAccess (they have no contactKey / sign-in path).
        ...(isManager ? {} : { portalAccess: 'pending' }),
        schoolGrade: null,
        birthMonthYear: null,
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
      });
    }

    // If there were no adult rows at all, synthesize a manager from the
    // primary-contact tuple so the family is signable-in-able.
    if (managerIds.length === 0) {
      const mid = `${fid}-${zeroPad(seq++)}`;
      memberMids.push(mid);
      managerIds.push(mid);

      txn.set(db.collection('families').doc(fid).collection('members').doc(mid), {
        mid,
        publicMid: publicMids[publicMidCursor++]!,
        uid: null,
        firstName: legacy.primaryFirstName,
        lastName: legacy.primaryLastName,
        type: 'Adult',
        gender: 'PreferNotToSay',
        manager: true,
        joinedAt: now,
        email: legacy.primaryEmail,
        phone: legacy.primaryPhone,
        schoolGrade: null,
        birthMonthYear: null,
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
      });
    }

    // Children
    for (const child of legacy.children) {
      const mid = `${fid}-${zeroPad(seq++)}`;
      memberMids.push(mid);
      txn.set(db.collection('families').doc(fid).collection('members').doc(mid), {
        mid,
        publicMid: publicMids[publicMidCursor++]!,
        uid: null,
        firstName: child.firstName,
        lastName: child.lastName,
        type: 'Child',
        gender: child.gender,
        manager: false,
        joinedAt: now,
        email: null,
        phone: null,
        schoolGrade: child.schoolGrade,
        legacySid: child.legacySid,
        birthMonthYear: null,
        birthMonth: child.birthMonth ?? null,
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
      });
    }

    txn.set(db.collection('families').doc(fid), {
      fid,
      legacyFid,
      name: legacy.familyName,
      location: legacy.location,
      createdAt: now,
      managers: managerIds,
      searchKeys: searchKeysFor(legacy, fid),
    });

    // ContactKey docs — primary tuple plus each adult's own email/phone. The
    // manager owns the primary keys; other adults own theirs. Dedupe so we
    // don't write the same contactKey doc twice in one txn (Firestore would
    // throw "set called twice on doc").
    const writtenKeys = new Set<string>();
    function writeKey(type: 'email' | 'phone', value: string | null, mid: string) {
      if (!value) return;
      const hash = hashContactKey(type, value);
      if (writtenKeys.has(hash)) return;
      writtenKeys.add(hash);
      txn.set(db.collection('contactKeys').doc(hash), {
        contactKey: hash,
        type,
        fid,
        mid,
      });
    }

    const managerMid = managerIds[0]!;
    writeKey('email', legacy.primaryEmail, managerMid);
    writeKey('phone', legacy.primaryPhone, managerMid);
    legacy.adults.forEach((adult, idx) => {
      const mid = memberMids[idx]!;
      writeKey('email', adult.email, mid);
      writeKey('phone', adult.phone, mid);
    });

    return { migrated: true, fid, legacyFid };
  });

  return result as LazyMigrateResult;
}
