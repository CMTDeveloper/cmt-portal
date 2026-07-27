// TEMPORARY: assemble the gate's inputs from the seeded UAT fixtures and run the
// PURE predicate, so the fixture shapes are proven before the owner flips the
// flag and the browser E2E runs. Delete after use.
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { needsAdultClassSelection } from '@/features/setu/adult-class/needs-selection';
import { selectableAdults } from '@/features/setu/adult-class/selectable-adults';

const ASC_OID = 'adult-study-class-brampton-2026-27';
const EXPECT: Record<string, { fires: boolean; selectable: number }> = {
  'e2e-ac-row1@chinmayatoronto.org': { fires: true, selectable: 2 },
  'e2e-ac-row2@chinmayatoronto.org': { fires: true, selectable: 1 },
  'e2e-ac-row3@chinmayatoronto.org': { fires: false, selectable: 0 },
  'e2e-ac-row5@chinmayatoronto.org': { fires: true, selectable: 1 },
  'e2e-ac-row6@chinmayatoronto.org': { fires: false, selectable: 2 },
  'e2e-ac-row7@chinmayatoronto.org': { fires: false, selectable: 0 },
};

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date } | null;
  return t?.toDate ? t.toDate() : new Date(v as string);
}

async function main() {
  const db = portalFirestore();
  const famSnap = await db.collection('families').where('_test', '==', true).get();
  let failures = 0;

  for (const [email, want] of Object.entries(EXPECT)) {
    const row = email.match(/row(\d)/)![1];
    const fam = famSnap.docs.find((d) => (d.data()['name'] as string)?.endsWith(`Row${row}`));
    if (!fam) { console.log(`✗ ${email}: family not found`); failures++; continue; }
    const fid = fam.id;

    const members = (await fam.ref.collection('members').get()).docs.map((d) => d.data() as never);
    const enrSnap = await fam.ref.collection('enrollments').get();
    const offerings = new Map<string, Record<string, unknown>>();
    for (const e of enrSnap.docs) {
      const oid = String(e.data()['oid']);
      if (!offerings.has(oid)) {
        const o = await db.collection('offerings').doc(oid).get();
        if (o.exists) offerings.set(oid, o.data()!);
      }
    }
    const enrollments = enrSnap.docs.map((d) => {
      const x = d.data();
      const off = offerings.get(String(x['oid'])) ?? null;
      return {
        ...x,
        enrolledAt: toDate(x['enrolledAt']),
        offering: off ? { ...off, startDate: toDate(off['startDate']), endDate: off['endDate'] ? toDate(off['endDate']) : null } : null,
        effectiveSuggestedAmount: (x['suggestedAmountOverride'] as number | null) ?? 0,
      };
    }) as never[];

    const donations = (await db.collection('donations').where('fid', '==', fid).get()).docs.map((d) => {
      const x = d.data();
      return { status: String(x['status']), eid: (x['eid'] as string) ?? null, amountCAD: Number(x['amountCAD'] ?? 0) };
    });

    const teacherMids = new Set<string>();
    for (const m of members as Array<{ mid: string }>) {
      const t = await db.collection('teacherAssignments').doc(m.mid).get();
      const ids = (t.data()?.['levelIds'] as string[] | undefined) ?? [];
      if (ids.length > 0) teacherMids.add(m.mid);
    }

    const fires = needsAdultClassSelection({
      isManager: true,
      members,
      enrollments,
      donations,
      currentOffering: { oid: ASC_OID },
      teacherAssignedMids: teacherMids,
      legacyPaymentStatus: 'unknown',
    });
    const selectable = selectableAdults(members, teacherMids).length;

    const ok = fires === want.fires && selectable === want.selectable;
    if (!ok) failures++;
    console.log(
      `${ok ? '✓' : '✗'} row${row} ${fid}: gate=${fires} (want ${want.fires})  ` +
        `selectable=${selectable} (want ${want.selectable})  teachers=${teacherMids.size} donations=${donations.length}`,
    );
  }

  console.log(failures === 0 ? '\nALL FIXTURES CORRECT' : `\n${failures} FIXTURE(S) WRONG`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
