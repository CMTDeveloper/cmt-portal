import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { mintPasswordSession } from '@/features/setu/auth/mint-password-session';
import { requestFamilyAccess } from '@/features/setu/join-request/request-family-access';
import { portalBaseUrl } from '@/lib/portal-base-url';
import { portalEnv } from '@/lib/env';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mode: z.enum(['web', 'mobile']).optional(),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const reqUrl = new URL(req.url);
  const urlMode = reqUrl.searchParams.get('mode');
  const mode = urlMode === 'mobile' || parsed.data.mode === 'mobile' ? 'mobile' : 'web';
  const from = reqUrl.searchParams.get('from');

  const result = await mintPasswordSession({ email, password, from, mode });

  switch (result.status) {
    case 'error':
      return NextResponse.json(
        result.resetAt !== undefined
          ? { error: result.error, resetAt: result.resetAt }
          : { error: result.error },
        { status: result.httpStatus },
      );
    case 'pending-approval':
      // Gated member: the email resolves to a non-manager member whose
      // portalAccess === 'pending' (awaiting a manager's approval). Even with a
      // valid password we do NOT mint a family session - the gate must hold on
      // every sign-in path, not just OTP.
      //
      // And the manager has to be TOLD, on every path that reaches this state.
      // Codex review of 1e498a0: the original fix wired only verify-code, so
      // two of the three sign-in paths still produced a pending member and
      // notified nobody - the same defect, one caller over. A correct password
      // proves ownership of this address just as an OTP does.
      await requestFamilyAccess({
        type: 'email',
        value: email,
        ttlDays: portalEnv().SETU_INVITE_TTL_DAYS,
        baseUrl: portalBaseUrl(req),
      }).catch(() => undefined);
      return NextResponse.json(
        {
          pendingApproval: true,
          pendingFid: result.pendingFid,
          pendingMatchedMid: result.pendingMatchedMid,
        },
        { status: 200 },
      );
    case 'no-session':
      return NextResponse.json({ redirectTo: result.redirectTo }, { status: 200 });
    case 'mobile':
      return NextResponse.json({ customToken: result.customToken }, { status: 200 });
    case 'session': {
      const res = NextResponse.json({ redirectTo: result.redirectTo }, { status: 200 });
      res.cookies.set('__session', result.cookieValue, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: result.maxAgeSeconds,
      });
      return res;
    }
  }
}
