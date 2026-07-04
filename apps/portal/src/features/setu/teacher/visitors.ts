import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { levelGradeSummary, normalizeGrade, type LevelDoc, type LevelKind } from '@cmt/shared-domain';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { readDoorGuestCheckIns } from '@/features/setu/attendance/check-in-attendance';
import { listGuestsDetailed, markGuest, type DetailedGuest } from './guests';
import { upsertPendingFamilyChild } from './pending-family';

/**
 * Does a door guest child belong on this level? Door guests carry only a grade
 * (no birthMonthYear), so only `level`/`pre-level` can match — by normalized
 * grade ∈ gradeBand. shishu/parents never auto-match a door guest (documented:
 * those visitors come in via the in-class quick-add). A blank grade never
 * matches; the teacher quick-adds it instead.
 */
export function guestMatchesLevel(
  child: { grade: string },
  level: { levelKind: LevelKind; gradeBand: string[] },
): boolean {
  if (level.levelKind !== 'level' && level.levelKind !== 'pre-level') return false;
  const g = normalizeGrade(child.grade);
  if (g === '') return false;
  return level.gradeBand.some((band) => normalizeGrade(band) === g);
}

export interface VisitorRow {
  name: string;
  grade: string;
  parentEmail: string;
  parentName: string | null;
  phone: string | null;
  alreadyConfirmed: boolean; // a portal guest mark already exists for this family at this level+date
}

export interface VisitorsView {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string | null;
  date: string;
  doorVisitors: VisitorRow[];
  confirmed: DetailedGuest[];
}

/**
 * The Visitors screen read model: the date's door guest children matched to this
 * level by grade (each flagged if their parent already claims a family that's
 * already a confirmed guest here), plus the list of guests already marked in the
 * portal for this level+date. null if the level is missing.
 */
export async function getLevelVisitorsView(levelId: string, date: string): Promise<VisitorsView | null> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(levelId).get();
  if (!levelSnap.exists) return null;
  const level = levelSnap.data() as LevelDoc;

  const [doorChildren, confirmed] = await Promise.all([
    readDoorGuestCheckIns(date),
    listGuestsDetailed(levelId, date),
  ]);
  const confirmedFids = new Set(confirmed.map((g) => g.fid));

  const matched = doorChildren.filter((c) => guestMatchesLevel(c, level));
  const doorVisitors = await Promise.all(
    matched.map(async (c): Promise<VisitorRow> => {
      let alreadyConfirmed = false;
      try {
        const keySnap = await db.collection('contactKeys').doc(hashContactKey('email', c.parentEmail)).get();
        if (keySnap.exists) {
          const fid = (keySnap.data() as { fid?: string }).fid;
          alreadyConfirmed = !!fid && confirmedFids.has(fid);
        }
      } catch {
        // a contactKey read miss just means "not yet confirmed" — never fail the view
      }
      return {
        name: c.name,
        grade: c.grade,
        parentEmail: c.parentEmail,
        parentName: c.parentName,
        phone: c.phone,
        alreadyConfirmed,
      };
    }),
  );

  return {
    levelId,
    levelName: level.levelName,
    ageLabel: levelGradeSummary(level),
    location: level.location,
    date,
    doorVisitors,
    confirmed,
  };
}

export interface AddVisitorParams {
  levelId: string;
  date: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  gender: 'Male' | 'Female' | 'PreferNotToSay';
  parentEmail: string | null;
  parentPhone: string | null;
  markedByUid: string;
  markedByMid: string | null;
}

export type AddVisitorResult =
  | { ok: true; fid: string; childMid: string; createdFamily: boolean; autoEnrolled: boolean; claimable: boolean }
  | { ok: false; reason: 'level-not-found' };

/**
 * Confirm a door guest or add a walk-in: upsert the pending family/child (shared
 * core; email/phone optional) then mark the child present as a guest (auto-
 * enrolls the family for the level's offering). `claimable` is false when no
 * contact was provided — the family exists but the parent can't claim it until a
 * contact is added later.
 */
export async function addVisitorOnPrompt(params: AddVisitorParams): Promise<AddVisitorResult> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(params.levelId).get();
  if (!levelSnap.exists) return { ok: false, reason: 'level-not-found' };
  const level = levelSnap.data() as LevelDoc;

  const { fid, childMid, createdFamily } = await upsertPendingFamilyChild(db, {
    levelLocation: level.location,
    firstName: params.firstName,
    lastName: params.lastName,
    schoolGrade: params.schoolGrade,
    gender: params.gender,
    parentEmail: params.parentEmail,
    parentPhone: params.parentPhone,
  });

  const guest = await markGuest({
    levelId: params.levelId,
    date: params.date,
    mid: childMid,
    status: 'present',
    markedByUid: params.markedByUid,
    markedByMid: params.markedByMid,
  });

  return {
    ok: true,
    fid,
    childMid,
    createdFamily,
    autoEnrolled: guest.ok ? guest.autoEnrolled : false,
    claimable: !!(params.parentEmail || params.parentPhone),
  };
}
