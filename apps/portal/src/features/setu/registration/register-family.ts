import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import type { FamilyAddress } from '@cmt/shared-domain';
import { hashContactKey } from './hash-contact-key';
import { generateFid } from './generate-fid';
import { allocateFamilyPublicId, allocateMemberPublicIds } from '@/features/setu/ids/public-id-allocator';

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
  volunteeringSkills?: string[];
  email?: string;
  phone?: string;
}

export interface RegisterFamilyManager {
  firstName: string;
  lastName: string;
  gender: Gender;
  foodAllergies?: string;
  volunteeringSkills?: string[];
}

export interface RegisterFamilyInput {
  email: string;
  phone: string;
  familyName: string;
  location: Location;
  // Optional here so non-route callers (seeds/tests) keep compiling; the
  // register ROUTE + form enforce required-ness. Written conditionally below.
  familyAddress?: FamilyAddress;
  manager: RegisterFamilyManager;
  additionalMembers: AdditionalMember[];
}

export interface RegisterFamilyResult {
  fid: string;
  mid: string;
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Derive the canonical numeric birthMonth (1-12) from a `'YYYY-MM'` string so
 * prasad assignment + reads can use it directly. Returns null when the input is
 * absent or not a recognizable `'YYYY-MM'` (defensive — never throws).
 */
export function deriveBirthMonth(birthMonthYear: string | undefined | null): number | null {
  if (!birthMonthYear) return null;
  const match = /^\d{4}-(\d{2})$/.exec(birthMonthYear.trim());
  if (!match || !match[1]) return null;
  const month = Number(match[1]);
  return month >= 1 && month <= 12 ? month : null;
}

export async function registerFamily(input: RegisterFamilyInput): Promise<RegisterFamilyResult> {
  const db = portalFirestore();
  const emailHash = hashContactKey('email', input.email);
  const phoneHash = hashContactKey('phone', input.phone);

  const fid = generateFid();
  const managerMid = `${fid}-01`;
  const now = FieldValue.serverTimestamp();

  // Allocate the user-facing 4-digit publicFid + a contiguous block of 5-digit
  // publicMids (one per member: manager + each additional). These MUST run BEFORE
  // db.runTransaction opens — the allocator runs its own Firestore transaction and
  // Firestore forbids nested transactions. publicMids[0] is always the MANAGER's;
  // additional members map by a clean 0-based loop index (manager=[0], first
  // additional=[1], …) — see the loop below.
  const publicFid = await allocateFamilyPublicId();
  const publicMids = await allocateMemberPublicIds(1 + input.additionalMembers.length);
  const managerPublicMid = publicMids[0]!;

  // The manager always owns its own email + phone contactKeys. An additional
  // adult MAY reuse the manager's contact (owner decision #3, 2026-06-22) — that
  // is a SHARE, not a conflict: the member doc still stores the value, but no
  // second contactKey is written, so the manager keeps ownership and manager
  // sign-in still resolves to the manager (not the reusing member).
  const managerHashes = new Set<string>([emailHash, phoneHash]);

  // Collect every contactKey we plan to write so we can read+verify them ALL
  // inside the transaction before any writes (Firestore requires reads before
  // writes in a txn). Manager keys are always present; a member's key is added
  // ONLY when it isn't a reuse of the manager's contact.
  const contactHashes: { hash: string; type: 'email' | 'phone'; origin: string }[] = [
    { hash: emailHash, type: 'email', origin: 'manager email' },
    { hash: phoneHash, type: 'phone', origin: 'manager phone' },
  ];

  // Refuse only when two DIFFERENT non-manager members claim the SAME new contact
  // (genuinely ambiguous — which member would sign-in resolve to?). Reusing the
  // manager's contact is allowed (handled above). Throwing here, before the
  // transaction, means no partial writes and each NEW contact maps to one member.
  const memberSeen = new Set<string>();
  for (const m of input.additionalMembers) {
    if (m.email) {
      const hash = hashContactKey('email', m.email);
      if (!managerHashes.has(hash)) {
        if (memberSeen.has(hash)) throw new Error('duplicate-contact-in-form');
        memberSeen.add(hash);
        contactHashes.push({ hash, type: 'email', origin: `${m.firstName} ${m.lastName} email` });
      }
    }
    if (m.phone) {
      const hash = hashContactKey('phone', m.phone);
      if (!managerHashes.has(hash)) {
        if (memberSeen.has(hash)) throw new Error('duplicate-contact-in-form');
        memberSeen.add(hash);
        contactHashes.push({ hash, type: 'phone', origin: `${m.firstName} ${m.lastName} phone` });
      }
    }
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
      publicFid,
      legacyFid: null,
      name: input.familyName,
      location: input.location,
      // Write the required home address only when supplied - never assign
      // undefined (exactOptionalPropertyTypes). The route always supplies it.
      ...(input.familyAddress ? { familyAddress: input.familyAddress } : {}),
      createdAt: now,
      managers: [managerMid],
      searchKeys,
    });

    // Create manager member — families/{fid}/members/{fid}-01
    const managerRef = db.collection('families').doc(fid).collection('members').doc(managerMid);
    txn.set(managerRef, {
      mid: managerMid,
      publicMid: managerPublicMid,
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
      birthMonth: null,
      volunteeringSkills: input.manager.volunteeringSkills ?? [],
      foodAllergies: input.manager.foodAllergies ?? null,
      emergencyContacts: [null, null],
    });

    // Create additional members
    let seq = 2;
    // memberIndex is a CLEAN 0-based loop index used ONLY for the publicMid map —
    // do NOT reuse `seq` here: it is consumed via post-increment (`zeroPad(seq++)`)
    // above, so reading it after would be off-by-one. publicMids[0] is the manager,
    // so the first additional member gets publicMids[1], the second publicMids[2], …
    input.additionalMembers.forEach((member, memberIndex) => {
      const mid = `${fid}-${zeroPad(seq++)}`;
      const memberPublicMid = publicMids[memberIndex + 1]!;
      const memberRef = db.collection('families').doc(fid).collection('members').doc(mid);
      txn.set(memberRef, {
        mid,
        publicMid: memberPublicMid,
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
        birthMonth: deriveBirthMonth(member.birthMonthYear),
        volunteeringSkills: member.volunteeringSkills ?? [],
        foodAllergies: member.foodAllergies ?? null,
        emergencyContacts: [null, null],
      });

      // Create contactKey docs for additional member contacts — but NOT when the
      // member reuses the manager's contact (the manager owns that key; writing a
      // second doc for the same hash would re-point sign-in to this member).
      if (member.email) {
        const hash = hashContactKey('email', member.email);
        if (!managerHashes.has(hash)) {
          txn.set(db.collection('contactKeys').doc(hash), {
            contactKey: hash,
            type: 'email',
            fid,
            mid,
          });
        }
      }
      if (member.phone) {
        const hash = hashContactKey('phone', member.phone);
        if (!managerHashes.has(hash)) {
          txn.set(db.collection('contactKeys').doc(hash), {
            contactKey: hash,
            type: 'phone',
            fid,
            mid,
          });
        }
      }
    });

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
