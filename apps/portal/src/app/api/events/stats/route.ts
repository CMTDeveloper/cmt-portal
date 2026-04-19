import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface RegistrationData {
  mothersInPuja?: number;
  adults?: number;
  children?: number;
  additionalAttendees?: number;
  paymentStatus?: string;
  category?: string;
  isBvFamily?: boolean;
  contribution?: number;
  payment_source?: string;
}

export async function GET(req: Request) {
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.WEBHOOK_API_KEY;
  if (!apiKey || !expectedKey || !safeEqual(apiKey, expectedKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await registrationsCollection().get();

    let totalRegistrations = 0;
    let totalMothers = 0;
    let totalAttendees = 0;
    let totalContribution = 0;
    let mothersFromPaid = 0;
    let attendeesFromPaid = 0;

    const byStatus: Record<string, number> = {
      pending: 0,
      completed: 0,
      review: 0,
      failed: 0,
      refunded: 0,
      cancelled: 0,
    };

    const byCategory: Record<string, number> = {
      'bv-family': 0,
      sevak: 0,
      'non-bv': 0,
      legacy: 0,
    };

    const byPaymentSource: Record<string, number> = {
      stripe: 0,
      etransfer: 0,
      unknown: 0,
    };

    snapshot.forEach((doc) => {
      const data = doc.data() as RegistrationData;
      totalRegistrations += 1;

      const mothers = Number(data.mothersInPuja) || 0;
      const adults = Number(data.adults) || 0;
      const children = Number(data.children) || 0;
      const additional = Number(data.additionalAttendees) || 0;
      const contribution = Number(data.contribution) || 0;
      const attendees = adults + children + additional;

      totalMothers += mothers;
      totalAttendees += attendees;
      totalContribution += contribution;

      const status = data.paymentStatus || 'pending';
      if (status in byStatus) byStatus[status] = (byStatus[status] ?? 0) + 1;
      else byStatus[status] = 1;

      if (status === 'completed' || status === 'review') {
        mothersFromPaid += mothers;
        attendeesFromPaid += attendees;
      }

      // Records without category are legacy (pre-V2), regardless of isBvFamily
      const category = data.category ?? 'legacy';
      if (category in byCategory) byCategory[category] = (byCategory[category] ?? 0) + 1;
      else byCategory[category] = 1;

      const source = data.payment_source || 'unknown';
      if (source in byPaymentSource) byPaymentSource[source] = (byPaymentSource[source] ?? 0) + 1;
      else byPaymentSource[source] = 1;
    });

    return NextResponse.json({
      campaign: process.env.NEXT_PUBLIC_EVENT_CAMPAIGN || '2026MothersDay',
      generatedAt: new Date().toISOString(),
      totalRegistrations,
      totalMothers,
      totalAttendees,
      totalContribution: Number(totalContribution.toFixed(2)),
      paid: {
        mothers: mothersFromPaid,
        attendees: attendeesFromPaid,
      },
      byStatus,
      byCategory,
      byPaymentSource,
    });
  } catch (err) {
    console.error('Stats query failed:', (err as Error).message);
    return NextResponse.json({ error: 'Failed to compute stats' }, { status: 500 });
  }
}
