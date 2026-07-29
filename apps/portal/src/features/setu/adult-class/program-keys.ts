import 'server-only';
import { isAdultStudyClassProgram } from '@cmt/shared-domain';
import { listPrograms } from '@/features/setu/programs/get-programs';

/**
 * Every ACTIVE program that is an Adult Study Class.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The adult-class gate and both enrollment doors used to compare against the
 * single literal `ADULT_STUDY_CLASS` key. Scarborough's class was created as its
 * own program (`adult-study-east`, 2026-07-28), so none of them could ever fire
 * for a Scarborough family: they enrolled, paid, and were never asked who
 * attends. Nothing logged a mismatch, because from the code's point of view
 * there simply was no adult-class offering for that centre.
 *
 * CMT's decision (2026-07-29) is that each centre may run its OWN adult-class
 * program with its own name, rather than one program with two locations. So
 * "which programs are the adult class" becomes data, and this is the one place
 * that answers it.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * `listPrograms()` is `use cache`d on the 'programs' tag, so this is free on the
 * gate's hot path - which matters, because the gate runs on EVERY `/family/*`
 * render. It is not a Firestore query per request.
 *
 * ── Only ACTIVE programs ────────────────────────────────────────────────────
 * An archived or draft program must not gate a family. `assertProgramActive`
 * already refuses one at enroll time; excluding them here means the family is
 * never asked in the first place, rather than being asked and then refused.
 *
 * Order is `listPrograms`' own displayOrder. Callers must NOT treat the first
 * entry as "the" adult class - a family's offering is chosen by
 * `resolveCurrentOffering`, which prefers their own centre.
 */
export async function adultStudyClassProgramKeys(): Promise<string[]> {
  const programs = await listPrograms();
  return programs.filter((p) => p.status === 'active' && isAdultStudyClassProgram(p)).map((p) => p.programKey);
}

/**
 * Is this offering's program an adult study class? The question both enrollment
 * doors ask, having resolved an oid to its programKey.
 */
export async function isAdultStudyClassKey(programKey: string | null): Promise<boolean> {
  if (!programKey) return false;
  return (await adultStudyClassProgramKeys()).includes(programKey);
}
