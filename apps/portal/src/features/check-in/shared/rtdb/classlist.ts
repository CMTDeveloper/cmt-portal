import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type { Student } from '@cmt/shared-domain/check-in';
import type { ClassRoster } from '@cmt/shared-domain/check-in';

interface RtdbClass {
  name: string;
  studentIds: string[];
}

export async function listClasses(): Promise<
  Array<{ classId: string; name: string; studentCount: number }>
> {
  const all = (await readRtdb<Record<string, RtdbClass>>('/classes')) ?? {};
  return Object.entries(all).map(([classId, c]) => ({
    classId,
    name: c.name,
    studentCount: (c.studentIds ?? []).length,
  }));
}

export async function getRosterForClass(classId: string): Promise<ClassRoster | null> {
  const cls = await readRtdb<RtdbClass>(`/classes/${classId}`);
  if (!cls) return null;
  const students: Student[] = [];
  for (const sid of cls.studentIds ?? []) {
    const student = await readRtdb<Student>(`/students/${sid}`);
    if (student) students.push(student);
  }
  return { classId, name: cls.name, students };
}
