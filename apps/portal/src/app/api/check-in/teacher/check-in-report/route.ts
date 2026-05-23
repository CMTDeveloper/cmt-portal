import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';


interface LegacyRosterStudent {
  sid?: string | number;
  fid?: string | number;
  fname?: string;
  lname?: string;
  pfname?: string;
  plname?: string;
  grade?: number;
  center?: string;
}

function getSundaysInMonth(yearMonth: string): string[] {
  const [year, month] = yearMonth.split('-').map(Number);
  if (!year || !month) return [];
  const sundays: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() + 1);
  }
  while (d.getMonth() === month - 1) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    sundays.push(`${d.getFullYear()}-${mm}-${dd}`);
    d.setDate(d.getDate() + 7);
  }
  return sundays;
}

function currentYearMonth(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${mm}`;
}

function isCheckedInDoc(data: Record<string, unknown>): boolean {
  const students = data.students;
  if (!students) return false;
  if (Array.isArray(students)) {
    return students.some(
      (s: unknown) =>
        s != null &&
        typeof s === 'object' &&
        ((s as Record<string, unknown>).isCheckedIn === true ||
          (s as Record<string, unknown>).isCheckedIn === 'true'),
    );
  }
  if (typeof students === 'object') {
    return Object.values(students as Record<string, unknown>).some(
      (v) => v === true || v === 'true',
    );
  }
  return false;
}

export async function GET(req: Request) {
  if (!flags.checkInTeacher) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const uid = req.headers.get('x-portal-uid');
  if (!uid) {
    return NextResponse.json({ error: 'no-uid' }, { status: 401 });
  }

  const url = new URL(req.url);
  const center = url.searchParams.get('center');
  if (!center) {
    return NextResponse.json({ error: 'center required' }, { status: 400 });
  }

  const month = url.searchParams.get('month') ?? currentYearMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  }

  const roster =
    (await readRtdb<Record<string, LegacyRosterStudent>>('/roster')) ?? {};
  const rows = Object.values(roster);

  // Extract unique centers from roster
  const centersSet = new Set<string>();
  for (const row of rows) {
    if (row.center) centersSet.add(row.center);
  }
  const centers = Array.from(centersSet).sort();

  // Build family map for the requested center
  const familyNames: Record<string, string> = {};

  // First pass — student rows give a fallback name
  for (const row of rows) {
    if (row.center !== center || !row.fid) continue;
    const fid = String(row.fid);
    if (!familyNames[fid] && row.lname) {
      familyNames[fid] = `${row.lname}, ${row.fname ?? ''}`.trim();
    }
  }

  // Second pass — parent rows (grade 99) override with plname/pfname
  for (const row of rows) {
    if (row.grade !== 99 || row.center !== center || !row.fid) continue;
    const fid = String(row.fid);
    if (fid in familyNames && row.plname) {
      familyNames[fid] = `${row.plname}, ${row.pfname ?? ''}`.trim();
    }
  }

  const familyIds = Object.keys(familyNames);
  const dates = getSundaysInMonth(month);

  // Initialise result grid
  type FamilyEntry = { name: string; checkIns: Record<string, boolean> };
  const families: Record<string, FamilyEntry> = {};
  for (const fid of familyIds) {
    const checkIns: Record<string, boolean> = {};
    for (const date of dates) checkIns[date] = false;
    families[fid] = { name: familyNames[fid] ?? fid, checkIns };
  }

  if (familyIds.length > 0 && dates.length > 0) {
    const db = portalFirestore();

    // Batch all Firestore reads in one Promise.all round-trip
    const tasks: Array<{ fid: string; date: string; ref: FirebaseFirestore.DocumentReference }> = [];
    for (const fid of familyIds) {
      for (const date of dates) {
        tasks.push({
          fid,
          date,
          ref: db.collection('family-check-ins').doc(fid).collection('checkIns').doc(date),
        });
      }
    }

    const snapshots = await Promise.all(tasks.map((t) => t.ref.get()));

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const task = tasks[i];
      if (!snap || !task) continue;
      if (snap.exists) {
        const data = snap.data() as Record<string, unknown>;
        families[task.fid]!.checkIns[task.date] = isCheckedInDoc(data);
      }
    }
  }

  return NextResponse.json(
    {
      families,
      dates,
      totalFamilies: familyIds.length,
      centers,
    },
    { status: 200 },
  );
}
