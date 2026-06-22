import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { declineJoinRequest } from '@/features/setu/join-request/decline-request';

const bodySchema = z.object({ token: z.string().min(1) });

// Manager-only. Marks the request 'declined'. No member changes.
export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const result = await declineJoinRequest({ token: parsed.data.token, managerFid: fid });

  if ('error' in result) {
    switch (result.error) {
      case 'not-found':
        return NextResponse.json({ error: 'not-found' }, { status: 404 });
      case 'fid-mismatch':
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      case 'already-resolved':
        return NextResponse.json({ error: 'already-resolved' }, { status: 409 });
      default:
        return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
