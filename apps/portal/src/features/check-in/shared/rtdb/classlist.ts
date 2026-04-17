import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type { Student } from '@cmt/shared-domain/check-in';
import type { ClassRoster } from '@cmt/shared-domain/check-in';

interface RtdbClass {
  name: string;
  studentIds: string[];
}

interface LegacyRosterRow {
  sid?: string | number;
  fid?: string | number;
  fname?: string;
  lname?: string;
  level?: string;
  grade?: number;
  pemail?: string | number;
  email?: string | number;
  phphone?: string | number;
  pmphone?: string | number;
  payment?: string;
}

export interface StudentWithContact extends Student {
  parentEmail: string;
  parentPhone: string;
  paymentStatus: string;
}

export interface ClassRosterWithContacts {
  classId: string;
  name: string;
  students: StudentWithContact[];
}

export async function listClasses(): Promise<
  Array<{ classId: string; name: string; studentCount: number }>
> {
  const all = (await readRtdb<Record<string, RtdbClass>>('/classes')) ?? {};
  const entries = Object.entries(all);
  if (entries.length > 0) {
    return entries.map(([classId, c]) => ({
      classId,
      name: c.name,
      studentCount: (c.studentIds ?? []).length,
    }));
  }

  const roster = (await readRtdb<Record<string, LegacyRosterRow>>('/roster')) ?? {};
  const byLevel = new Map<string, number>();
  for (const row of Object.values(roster)) {
    if (row.grade === 99) continue;
    const level = row.level?.trim();
    if (!level || level === 'NULL') continue;
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([level, count]) => ({ classId: level, name: level, studentCount: count }));
}

export async function getRosterForClass(classId: string): Promise<ClassRoster | null> {
  const cls = await readRtdb<RtdbClass>(`/classes/${classId}`);
  if (cls) {
    const students: Student[] = [];
    for (const sid of cls.studentIds ?? []) {
      const student = await readRtdb<Student>(`/students/${sid}`);
      if (student) students.push(student);
    }
    return { classId, name: cls.name, students };
  }

  const roster = (await readRtdb<Record<string, LegacyRosterRow>>('/roster')) ?? {};
  const rows = Object.values(roster).filter(
    (r) => r.grade !== 99 && r.level?.trim() === classId,
  );
  if (rows.length === 0) return null;

  const students: Student[] = rows
    .map((r) => {
      const sid = String(r.sid ?? '');
      const fid = String(r.fid ?? '');
      if (!sid || !fid) return null;
      return { sid, fid, firstName: r.fname ?? '', lastName: r.lname ?? '', level: r.level ?? '' };
    })
    .filter((s): s is Student => s !== null);

  return { classId, name: classId, students };
}

export async function getRosterWithContacts(
  classId: string,
): Promise<ClassRosterWithContacts | null> {
  const roster = (await readRtdb<Record<string, LegacyRosterRow>>('/roster')) ?? {};
  const allRows = Object.values(roster);

  const studentRows = allRows.filter(
    (r) => r.grade !== 99 && r.level?.trim() === classId,
  );
  if (studentRows.length === 0) return null;

  // Build fid -> parent contact map
  const parentByFid = new Map<string, { email: string; phone: string }>();
  for (const row of allRows) {
    if (row.grade !== 99) continue;
    const fid = String(row.fid ?? '');
    if (!fid) continue;
    if (!parentByFid.has(fid)) {
      const email = row.pemail ?? row.email;
      const phone = row.phphone ?? row.pmphone;
      parentByFid.set(fid, {
        email: email == null ? '' : String(email).trim(),
        phone: phone == null ? '' : String(phone).trim(),
      });
    }
  }

  const students: StudentWithContact[] = studentRows
    .map((r) => {
      const sid = String(r.sid ?? '');
      const fid = String(r.fid ?? '');
      if (!sid || !fid) return null;
      const contact = parentByFid.get(fid) ?? { email: '', phone: '' };
      const rawPayment = (r.payment ?? '').trim().toLowerCase();
      const paymentStatus = rawPayment.includes('unpaid') || rawPayment.includes('due')
        ? 'unpaid'
        : rawPayment.includes('paid') && !rawPayment.includes('partial')
          ? 'paid'
          : 'partial';
      return {
        sid,
        fid,
        firstName: r.fname ?? '',
        lastName: r.lname ?? '',
        level: r.level ?? '',
        parentEmail: contact.email,
        parentPhone: contact.phone,
        paymentStatus,
      } satisfies StudentWithContact;
    })
    .filter((s): s is StudentWithContact => s !== null);

  return { classId, name: classId, students };
}
