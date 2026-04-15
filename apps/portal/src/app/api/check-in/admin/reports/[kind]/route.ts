import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function escapeField(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

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
  const header = schema.headers.join(',');
  const body = rows
    .map((row) => schema.headers.map((h) => escapeField(row[h])).join(','))
    .join('\n');
  const csv = rows.length > 0 ? `${header}\n${body}` : header;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${kind}.csv"`,
    },
  });
}
