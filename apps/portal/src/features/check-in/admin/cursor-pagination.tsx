import Link from 'next/link';

interface Props {
  basePath: string;
  nextCursor: string | null;
}

export function CursorPagination({ basePath, nextCursor }: Props) {
  if (!nextCursor) return null;
  return (
    <div className="flex justify-end">
      <Link href={`${basePath}?cursor=${nextCursor}`} className="text-sm underline">
        Next page →
      </Link>
    </div>
  );
}
