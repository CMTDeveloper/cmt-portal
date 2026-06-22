import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { approveJoinRequest } from '@/features/setu/join-request/approve-request';

const bodySchema = z.object({ token: z.string().min(1) });

// Manager-only. Promotes the EXISTING matched member to co-manager
// (manager:true, arrayUnion into family.managers, portalAccess:'active'),
// ensures the member's contactKey (theft check), marks the request approved.
// Does NOT mint the requester's session — they sign in later via OTP.
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

  const result = await approveJoinRequest({ token: parsed.data.token, managerFid: fid });

  if ('error' in result) {
    switch (result.error) {
      case 'not-found':
        return NextResponse.json({ error: 'not-found' }, { status: 404 });
      case 'fid-mismatch':
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      case 'expired':
        return NextResponse.json({ error: 'expired' }, { status: 410 });
      case 'already-resolved':
        return NextResponse.json({ error: 'already-resolved' }, { status: 409 });
      case 'member-not-found':
        return NextResponse.json({ error: 'member-not-found' }, { status: 404 });
      case 'contact-conflict':
        return NextResponse.json({ error: 'contact-already-registered' }, { status: 409 });
      default:
        return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
