import { deriveRoster } from './roster';

export interface PreviousStudentRow { mid: string; fid: string; firstName: string; lastName: string; schoolGrade: string | null; }
export interface PreviousStudentsView { levelId: string; levelName: string; ageLabel: string; date: string; students: PreviousStudentRow[]; }

/** Read model for the Previous students page: active-but-unconfirmed carry-forwards for a level. */
export async function getLevelPreviousStudentsView(levelId: string, date: string): Promise<PreviousStudentsView | null> {
  // MUST pass withConfirmation:true, else previousStudents is always empty.
  const roster = await deriveRoster(levelId, date, undefined, { withConfirmation: true });
  if (!roster) return null;
  return {
    levelId: roster.levelId,
    levelName: roster.levelName,
    ageLabel: roster.ageLabel,
    date: roster.date,
    students: roster.previousStudents.map((m) => ({
      mid: m.mid, fid: m.fid, firstName: m.firstName, lastName: m.lastName, schoolGrade: m.schoolGrade,
    })),
  };
}
