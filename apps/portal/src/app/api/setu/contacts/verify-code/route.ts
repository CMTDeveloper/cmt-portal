import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { normalizeContact, verifyCode } from '@/features/check-in/shared';
import { isSetuFamily } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { addVerifiedContact, ContactInUseError } from '@/features/setu/contacts/add-verified-contact';

const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // Header-based session (cookie AND Bearer/mobile callers).
  const session = readSessionFromHeaders(req);
  if (!session || !isSetuFamily(session) || !session.fid || !session.mid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { type, value, code } = parsed.data;
  const normalized = normalizeContact(type, value);
  const ok = await verifyCode(normalized, code, type);
  if (!ok) {
    return NextResponse.json({ error: 'invalid-or-expired' }, { status: 400 });
  }

  try {
    await addVerifiedContact({
      fid: session.fid,
      mid: session.mid,
      type,
      value,
    });
  } catch (err) {
    if (err instanceof ContactInUseError) {
      return NextResponse.json({ error: 'contact-in-use' }, { status: 409 });
    }
    throw err;
  }

  revalidateTag(`family-${session.fid}`, 'max');
  return NextResponse.json({ success: true }, { status: 200 });
}
