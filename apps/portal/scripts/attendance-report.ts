/**
 * Monthly kids attendance report by Level.
 *
 * Reads from PROD Firebase project (chinmaya-setu-715b8) using MASTER credentials,
 * since the standalone chinmaya-family-check-in app writes its check_in_events there.
 *
 * Usage: pnpm --filter @cmt/portal attendance:report
 *   Optional flags:
 *     --start=YYYY-MM   (default: 2025-09)
 *     --end=YYYY-MM     (default: current month)
 *     --out=PATH        (default: ./attendance-kids-<start>-to-<end>.xlsx)
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { getMasterApp } from '@cmt/firebase-shared/admin/apps';
import ExcelJS from 'exceljs';
import path from 'node:path';

interface RosterRow {
  sid?: string | number;
  fid?: string | number;
  fname?: string;
  lname?: string;
  level?: string;
  grade?: number;
}

interface CheckInEvent {
  sid: string | number;
  fid?: string | number;
  status?: 'present' | 'absent';
  checkedInAt: string;
  checkedInBy?: string;
}

interface Kid {
  sid: string;
  fid: string;
  level: string;
  grade: number;
  firstName: string;
  lastName: string;
}

const TZ = 'America/Toronto';
const torontoParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function torontoYmd(iso: string): { date: string; month: string } {
  const parts = torontoParts.formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return { date: `${y}-${m}-${d}`, month: `${y}-${m}` };
}

function parseArgs(): { start: string; end: string; out?: string } {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) args.set(m[1]!, m[2]!);
  }
  const now = new Date();
  const defaultEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    start: args.get('start') ?? '2025-09',
    end: args.get('end') ?? defaultEnd,
    out: args.get('out'),
  };
}

function monthRangeIso(startMonth: string, endMonth: string): { startIso: string; endIso: string } {
  const [sy, sm] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  // First day of start month, Toronto local 00:00 (EDT is UTC-4, EST is UTC-5).
  // Use the broader window — query in UTC since checkedInAt is ISO; over-fetch
  // by a day and re-filter by Toronto month after parsing.
  const startUtc = new Date(Date.UTC(sy!, sm! - 1, 1, 0, 0, 0));
  // End: first day of (end+1) month in UTC, exclusive.
  const endUtc = new Date(Date.UTC(ey!, em!, 1, 0, 0, 0));
  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
}

async function main() {
  const { start, end, out } = parseArgs();
  const { startIso, endIso } = monthRangeIso(start, end);

  console.log(`[attendance-report] window: ${start}..${end} (${startIso} → ${endIso})`);

  const masterApp = getMasterApp();
  const fs = getFirestore(masterApp);
  const rtdb = getDatabase(masterApp);

  // 1) Roster → kid map keyed by sid (grade !== 99)
  console.log('[attendance-report] reading roster…');
  const rosterSnap = await rtdb.ref('/roster').once('value');
  const roster = (rosterSnap.val() ?? {}) as Record<string, RosterRow | null>;
  const kids = new Map<string, Kid>();
  const allLevels = new Set<string>();
  for (const row of Object.values(roster)) {
    if (!row) continue;
    if (row.grade === 99) continue;
    if (row.sid == null) continue;
    const sid = String(row.sid);
    const level = (row.level ?? '').trim();
    if (!level || level === 'NULL') continue;
    allLevels.add(level);
    kids.set(sid, {
      sid,
      fid: String(row.fid ?? ''),
      level,
      grade: Number(row.grade ?? 0),
      firstName: row.fname ?? '',
      lastName: row.lname ?? '',
    });
  }
  console.log(`[attendance-report] kids in roster: ${kids.size}, levels: ${allLevels.size}`);

  // 2) check_in_events in window
  console.log('[attendance-report] querying check_in_events…');
  const snap = await fs
    .collection('check_in_events')
    .where('checkedInAt', '>=', startIso)
    .where('checkedInAt', '<', endIso)
    .get();
  console.log(`[attendance-report] events fetched: ${snap.size}`);

  // 3) Pivot: level → month → count, plus detail rows
  const pivot = new Map<string, Map<string, number>>();
  const monthsInData = new Set<string>();
  const detail: Array<{
    date: string;
    month: string;
    level: string;
    grade: number;
    sid: string;
    fid: string;
    firstName: string;
    lastName: string;
    checkedInBy: string;
    checkedInAt: string;
  }> = [];

  let skippedNotKid = 0;
  let skippedAbsent = 0;

  for (const doc of snap.docs) {
    const ev = doc.data() as CheckInEvent;
    if (ev.status && ev.status !== 'present') {
      skippedAbsent++;
      continue;
    }
    const kid = kids.get(String(ev.sid));
    if (!kid) {
      skippedNotKid++;
      continue;
    }
    const { date, month } = torontoYmd(ev.checkedInAt);
    if (month < start || month > end) continue;
    monthsInData.add(month);
    let levelMap = pivot.get(kid.level);
    if (!levelMap) {
      levelMap = new Map();
      pivot.set(kid.level, levelMap);
    }
    levelMap.set(month, (levelMap.get(month) ?? 0) + 1);
    detail.push({
      date,
      month,
      level: kid.level,
      grade: kid.grade,
      sid: kid.sid,
      fid: kid.fid,
      firstName: kid.firstName,
      lastName: kid.lastName,
      checkedInBy: ev.checkedInBy ?? '',
      checkedInAt: ev.checkedInAt,
    });
  }

  console.log(
    `[attendance-report] kept ${detail.length} kid present check-ins. skipped: ${skippedAbsent} absent, ${skippedNotKid} non-kid/unknown-sid`,
  );

  // Use the wider of (months present in data) ∪ (full requested window) so empty months still show.
  const monthsAll = new Set(monthsInData);
  {
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    let y = sy!, m = sm!;
    while (y < ey! || (y === ey! && m <= em!)) {
      monthsAll.add(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { y++; m = 1; }
    }
  }
  const sortedMonths = [...monthsAll].sort();
  const levelsInData = new Set([...pivot.keys()]);
  // Include all roster levels even if 0 check-ins
  for (const l of allLevels) levelsInData.add(l);
  const sortedLevels = [...levelsInData].sort((a, b) => a.localeCompare(b));

  // 4) Write Excel
  const wb = new ExcelJS.Workbook();
  wb.creator = 'cmt-portal';
  wb.created = new Date();

  // Summary sheet
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Level', key: 'level', width: 32 },
    ...sortedMonths.map((m) => ({ header: m, key: m, width: 11 })),
    { header: 'Total', key: 'total', width: 12 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.getRow(1).alignment = { horizontal: 'center' };
  summary.getColumn('level').alignment = { horizontal: 'left' };

  for (const level of sortedLevels) {
    const row: Record<string, string | number> = { level };
    let total = 0;
    for (const m of sortedMonths) {
      const c = pivot.get(level)?.get(m) ?? 0;
      row[m] = c;
      total += c;
    }
    row['total'] = total;
    summary.addRow(row);
  }

  // Totals row
  const totalRow: Record<string, string | number> = { level: 'TOTAL' };
  let grand = 0;
  for (const m of sortedMonths) {
    const c = sortedLevels.reduce((s, l) => s + (pivot.get(l)?.get(m) ?? 0), 0);
    totalRow[m] = c;
    grand += c;
  }
  totalRow['total'] = grand;
  const trow = summary.addRow(totalRow);
  trow.font = { bold: true };
  trow.eachCell((cell) => {
    cell.border = { top: { style: 'thin' } };
  });

  // Detail sheet — sorted by date then level
  const det = wb.addWorksheet('Detail');
  det.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Month', key: 'month', width: 9 },
    { header: 'Level', key: 'level', width: 32 },
    { header: 'Grade', key: 'grade', width: 7 },
    { header: 'SID', key: 'sid', width: 14 },
    { header: 'FID', key: 'fid', width: 10 },
    { header: 'First Name', key: 'firstName', width: 18 },
    { header: 'Last Name', key: 'lastName', width: 18 },
    { header: 'Checked In By', key: 'checkedInBy', width: 14 },
    { header: 'Checked In At (UTC)', key: 'checkedInAt', width: 26 },
  ];
  det.getRow(1).font = { bold: true };
  detail.sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt) || a.level.localeCompare(b.level));
  for (const row of detail) det.addRow(row);
  det.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: det.columns.length } };

  const outPath = path.resolve(out ?? `attendance-kids-${start}-to-${end}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  console.log(`[attendance-report] wrote → ${outPath}`);
  console.log(
    `[attendance-report] summary: ${sortedLevels.length} levels × ${sortedMonths.length} months, grand total ${grand} check-ins`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[attendance-report] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
