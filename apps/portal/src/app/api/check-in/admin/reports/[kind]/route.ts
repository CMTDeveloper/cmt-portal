import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { csvRow } from '@/lib/csv';


type Kind = 'check-ins' | 'guests';

const SCHEMAS: Record<Kind, { collection: string; headers: string[]; orderBy: string }> = {
  'check-ins': {
    collection: 'check_in_events',
    headers: ['fid', 'sid', 'status', 'checkedInBy', 'checkedInAt'],
    orderBy: 'checkedInAt',
  },
  guests: {
    collection: 'guest_check_ins',
    headers: [
      'firstName',
      'lastName',
      'email',
      'phone',
      'numberOfAdults',
      'numberOfChildren',
      'checkedInAt',
    ],
    orderBy: 'checkedInAt',
  },
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const schema = SCHEMAS[kind as Kind];
  if (!schema) {
    return NextResponse.json({ error: 'unknown-kind' }, { status: 400 });
  }

  const snap = await portalFirestore()
    .collection(schema.collection)
    .orderBy(schema.orderBy, 'desc')
    .limit(10000)
    .get();

  const rows = snap.docs.map((d) => d.data() as Record<string, unknown>);
  // csvRow neutralizes spreadsheet formula injection (leading = + - @ / TAB / CR);
  // guest firstName/lastName come from the public kiosk form (user-controlled).
  const header = csvRow(schema.headers);
  const body = rows.map((row) => csvRow(schema.headers.map((h) => row[h]))).join('\n');
  const csv = rows.length > 0 ? `${header}\n${body}` : header;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${kind}.csv"`,
    },
  });
}
