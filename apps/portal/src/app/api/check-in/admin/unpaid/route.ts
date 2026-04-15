import { NextResponse } from 'next/server';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type { Family } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const all = (await readRtdb<Record<string, Family>>('/families')) ?? {};
  const families = Object.values(all).filter((f) => f.paymentStatus !== 'paid');
  return NextResponse.json({ families }, { status: 200 });
}
