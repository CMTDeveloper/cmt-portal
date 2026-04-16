import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { createCheckoutRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { checkIpRateLimit } from '@/features/events/shared/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRICE_PER_PERSON = 10.0;
const STRIPE_PERCENT_FEE = 0.022;
const STRIPE_FIXED_FEE = 0.3;

function verifyPricing(
  lineItems: { name: string; amount: number; quantity: number }[],
): boolean {
  for (const item of lineItems) {
    if (item.name === 'Adults' || item.name === 'Child' || item.name === 'BV Family') {
      if (item.amount !== PRICE_PER_PERSON) return false;
    }
    if (item.name === 'Processing Fees') {
      const otherItems = lineItems.filter((i) => i.name !== 'Processing Fees');
      const subtotal = otherItems.reduce(
        (sum, i) => sum + i.amount * i.quantity,
        0,
      );
      const expectedFee =
        Math.round((subtotal * STRIPE_PERCENT_FEE + STRIPE_FIXED_FEE) * 100) / 100;
      if (Math.abs(item.amount - expectedFee) > 0.01) return false;
    }
  }
  return true;
}

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  try {
    const { allowed } = await checkIpRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 },
      );
    }
  } catch {
    // degraded mode — allow through
  }

  let parsed: ReturnType<typeof createCheckoutRequestSchema.parse>;
  try {
    parsed = createCheckoutRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const allowedOrigins = [
    req.headers.get('origin'),
    new URL(req.url).origin,
    req.headers.get('referer') ? new URL(req.headers.get('referer')!).origin : null,
  ].filter(Boolean) as string[];

  const successOrigin = new URL(parsed.successUrl).origin;
  const cancelOrigin = new URL(parsed.cancelUrl).origin;

  const VERCEL_PROJECT_PATTERN = /^https:\/\/cmt-portal[a-z0-9-]*\.vercel\.app$/;
  const isValidRedirect =
    allowedOrigins.some((o) => successOrigin === o) ||
    VERCEL_PROJECT_PATTERN.test(successOrigin);
  const isValidCancel =
    allowedOrigins.some((o) => cancelOrigin === o) ||
    VERCEL_PROJECT_PATTERN.test(cancelOrigin);

  if (!isValidRedirect || !isValidCancel) {
    return NextResponse.json(
      { error: 'Invalid redirect URLs' },
      { status: 400 },
    );
  }

  if (!verifyPricing(parsed.lineItems)) {
    return NextResponse.json({ error: 'Invalid pricing' }, { status: 400 });
  }

  const response = await fetch(process.env.STRIPE_CHECKOUT_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.STRIPE_API_KEY!,
    },
    body: JSON.stringify(parsed),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Stripe checkout error:', response.status, text);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 502 },
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
