import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';
import { generateFid } from './generate-fid';
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

  const result = await db.runTransaction(async (txn) => {
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
        uid: null,
        firstName: adult.firstName || legacy.primaryFirstName,
        lastName: adult.lastName || legacy.primaryLastName,
        type: 'Adult',
        gender: adult.gender,
        manager: isManager,
        joinedAt: now,
        email: adult.email,
        phone: adult.phone,
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
