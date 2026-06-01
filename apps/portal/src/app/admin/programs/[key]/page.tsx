import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { SetuIcon } from '@cmt/ui';
import { getProgram } from '@/features/setu/programs/get-programs';
import { ProgramForm, type ProgramRow } from '@/features/admin/programs/program-form';
import { OfferingsPanel, type OfferingRow } from '@/features/admin/programs/offerings-panel';

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: `Program: ${key} — CMT Portal admin` };
}

type TS = ReturnType<typeof Timestamp.now>;

export default async function AdminProgramKeyPage({ params }: { params: Promise<{ key: string }> }) {
  await connection();
  const { key } = await params;

  const program = await getProgram(key);
  if (!program) notFound();

  const programRow: ProgramRow = {
    ...program,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
  };

  // Fetch offerings scoped to this program
  const db = portalFirestore();
  const offeringsSnap = await db
    .collection('offerings')
    .where('programKey', '==', key)
    .orderBy('startDate', 'desc')
    .get();

  const offerings: OfferingRow[] = offeringsSnap.docs.map((d) => {
    const data = d.data();
    return {
      oid: data['oid'] as string,
      programKey: data['programKey'] as string,
      programLabel: data['programLabel'] as string,
      location: (data['location'] ?? null) as OfferingRow['location'],
      termLabel: data['termLabel'] as string,
      termType: data['termType'] as OfferingRow['termType'],
      startDate: (data['startDate'] as TS).toDate().toISOString(),
      endDate: data['endDate'] != null ? (data['endDate'] as TS).toDate().toISOString() : null,
      pricingTiers: (data['pricingTiers'] ?? []) as OfferingRow['pricingTiers'],
      paymentSource: data['paymentSource'] as OfferingRow['paymentSource'],
      enabled: data['enabled'] as boolean,
      createdAt: (data['createdAt'] as TS).toDate().toISOString(),
      createdBy: data['createdBy'] as string,
      updatedAt: (data['updatedAt'] as TS).toDate().toISOString(),
      updatedBy: data['updatedBy'] as string,
    };
  });

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin/programs"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}
        >
          <SetuIcon.back /> Back to programs
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Admin · Programs
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>{program.label}</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, fontFamily: 'monospace' }}>{key}</p>
      </header>

      {/* Program editor */}
      <div className="card" style={{ padding: 'clamp(14px, 4vw, 22px)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 18 }}>Program settings</h2>
        <ProgramForm program={programRow} />
      </div>

      {/* Per-program offerings */}
      <div className="card" style={{ padding: 'clamp(14px, 4vw, 22px)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Offerings</h2>
        <p style={{ fontSize: 13, color: 'var(--body-text)', marginBottom: 18, lineHeight: 1.55 }}>
          Each offering is a specific run of this program (e.g. 2025-26 at Brampton). Families enroll
          into an offering, not the program directly. Use &ldquo;Duplicate&rdquo; to clone last year&apos;s
          offering with dates shifted forward.
        </p>
        <OfferingsPanel programKey={key} initialOfferings={offerings} />
      </div>
    </>
  );
}
