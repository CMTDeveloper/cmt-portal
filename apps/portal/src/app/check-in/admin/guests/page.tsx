import { notFound } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { GuestList } from '@/features/check-in/admin/guest-list';
import { CursorPagination } from '@/features/check-in/admin/cursor-pagination';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Guests' };

interface Props {
  searchParams: Promise<{ cursor?: string }>;
}

export default async function AdminGuestsPage({ searchParams }: Props) {
  if (!flags.checkInAdmin) notFound();
  const { cursor } = await searchParams;
  const limit = 20;

  const coll = portalFirestore().collection('guest_check_ins');
  let query = coll.orderBy('checkedInAt', 'desc');
  if (cursor) {
    const cursorSnap = await coll.doc(cursor).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap);
  }
  query = query.limit(limit);

  const snap = await query.get();
  const guests = snap.docs.map((d) => {
    const data = d.data() as {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      numberOfAdults: number;
      numberOfChildren: number;
      checkedInAt: string;
    };
    return { id: d.id, ...data };
  });
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1]?.id ?? null : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Guests</h1>
      <GuestList guests={guests} />
      <CursorPagination basePath="/check-in/admin/guests" nextCursor={nextCursor} />
    </main>
  );
}
