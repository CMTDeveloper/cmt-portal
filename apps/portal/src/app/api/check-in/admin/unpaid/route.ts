import { NextResponse } from 'next/server';
import { listAllFamilies } from '@/features/check-in/shared';


export async function GET() {
  const all = await listAllFamilies();
  const families = all.filter((f) => f.paymentStatus !== 'paid');
  return NextResponse.json({ families }, { status: 200 });
}
