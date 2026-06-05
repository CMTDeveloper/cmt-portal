import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';
import { generateFid } from './generate-fid';

export type Location = 'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham';
export type Gender = 'Male' | 'Female' | 'PreferNotToSay';
export type MemberType = 'Adult' | 'Child';

export interface AdditionalMember {
  firstName: string;
  lastName: string;
  type: MemberType;
  gender: Gender;
  schoolGrade?: string;
  birthMonthYear?: string;
  foodAllergies?: string;
  email?: string;
  phone?: string;
}

export interface RegisterFamilyInput {
  email: string;
  phone: string;
  familyName: string;
  location: Location;
  manager: { firstName: string; lastName: string; gender: Gender };
  additionalMembers: AdditionalMember[];
}

export interface RegisterFamilyResult {
  fid: string;
  mid: string;
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

export async function registerFamily(input: RegisterFamilyInput): Promise<RegisterFamilyResult> {
  const db = portalFirestore();
  const emailHash = hashContactKey('email', input.email);
  const phoneHash = hashContactKey('phone', input.phone);

  const fid = generateFid();
  const managerMid = `${fid}-01`;
  const now = FieldValue.serverTimestamp();

  // Collect every contactKey we plan to write so we can read+verify them ALL
  // inside the transaction before any writes (Firestore requires reads before
  // writes in a txn). Tracks origin so error messages can pinpoint the offender.
  const contactHashes: { hash: string; type: 'email' | 'phone'; origin: string }[] = [
    { hash: emailHash, type: 'email', origin: 'manager email' },
    { hash: phoneHash, type: 'phone', origin: 'manager phone' },
  ];
  for (const m of input.additionalMembers) {
    if (m.email) {
      contactHashes.push({
        hash: hashContactKey('email', m.email),
        type: 'email',
        origin: `${m.firstName} ${m.lastName} email`,
      });
    }
    if (m.phone) {
      contactHashes.push({
        hash: hashContactKey('phone', m.phone),
        type: 'phone',
        origin: `${m.firstName} ${m.lastName} phone`,
      });
    }
  }

  // Refuse if the SAME normalized contact was entered for two members of THIS
  // family (e.g. a parent typed their own email for a child, or two adults share
  // a phone). Writing the same contactKeys/{hash} doc twice in the transaction
  // would let the last write silently win — binding sign-in to whichever member
  // is written last. Throwing here (before the transaction) means no partial
  // writes happen and each contact maps to exactly one member.
  const seenHashes = new Set<string>();
  for (const c of contactHashes) {
    if (seenHashes.has(c.hash)) {
      throw new Error('duplicate-contact-in-form');
    }
    seenHashes.add(c.hash);
  }

  const result = await db.runTransaction(async (txn) => {
    // Read EVERY contactKey we plan to write, in parallel, inside the txn.
    // Any pre-existing key means another family already owns that contact —
    // refuse the whole registration to prevent contact-key theft.
    const snaps = await Promise.all(
      contactHashes.map((c) => txn.get(db.collection('contactKeys').doc(c.hash))),
    );
    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      const meta = contactHashes[i];
      if (snap && snap.exists && meta) {
        throw new Error(
          `Contact already registered: ${meta.origin} is linked to an existing family`,
        );
      }
    }

    const searchKeys = [
      input.familyName.toLowerCase(),
      fid,
    ];

    // Create families/{fid}
    const familyRef = db.collection('families').doc(fid);
    txn.set(familyRef, {
      fid,
      legacyFid: null,
      name: input.familyName,
      location: input.location,
      createdAt: now,
      managers: [managerMid],
      searchKeys,
    });

    // Create manager member — families/{fid}/members/{fid}-01
    const managerRef = db.collection('families').doc(fid).collection('members').doc(managerMid);
    txn.set(managerRef, {
      mid: managerMid,
      uid: null,
      firstName: input.manager.firstName,
      lastName: input.manager.lastName,
      type: 'Adult',
      gender: input.manager.gender,
      manager: true,
      joinedAt: now,
      email: input.email,
      phone: input.phone,
      schoolGrade: null,
      birthMonthYear: null,
      volunteeringSkills: [],
      foodAllergies: null,
      emergencyContacts: [null, null],
    });

    // Create additional members
    let seq = 2;
    for (const member of input.additionalMembers) {
      const mid = `${fid}-${zeroPad(seq++)}`;
      const memberRef = db.collection('families').doc(fid).collection('members').doc(mid);
      txn.set(memberRef, {
        mid,
        uid: null,
        firstName: member.firstName,
        lastName: member.lastName,
        type: member.type,
        gender: member.gender,
        manager: false,
        joinedAt: now,
        email: member.email ?? null,
        phone: member.phone ?? null,
        schoolGrade: member.schoolGrade ?? null,
        birthMonthYear: member.birthMonthYear ?? null,
        volunteeringSkills: [],
        foodAllergies: member.foodAllergies ?? null,
        emergencyContacts: [null, null],
      });

      // Create contactKey docs for additional member contacts
      if (member.email) {
        const hash = hashContactKey('email', member.email);
        txn.set(db.collection('contactKeys').doc(hash), {
          contactKey: hash,
          type: 'email',
          fid,
          mid,
        });
      }
      if (member.phone) {
        const hash = hashContactKey('phone', member.phone);
        txn.set(db.collection('contactKeys').doc(hash), {
          contactKey: hash,
          type: 'phone',
          fid,
          mid,
        });
      }
    }

    // Create contactKey docs for the manager (email + phone)
    txn.set(db.collection('contactKeys').doc(emailHash), {
      contactKey: emailHash,
      type: 'email',
      fid,
      mid: managerMid,
    });
    txn.set(db.collection('contactKeys').doc(phoneHash), {
      contactKey: phoneHash,
      type: 'phone',
      fid,
      mid: managerMid,
    });

    return { fid, mid: managerMid };
  });

  return result as RegisterFamilyResult;
}
