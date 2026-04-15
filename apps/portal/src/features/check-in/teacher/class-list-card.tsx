import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@cmt/ui';

interface Props {
  classId: string;
  name: string;
  studentCount: number;
}

export function ClassListCard({ classId, name, studentCount }: Props) {
  return (
    <Link
      href={`/check-in/teacher/attendance?classId=${classId}`}
      className="block focus:outline-none"
    >
      <Card className="h-full transition hover:shadow-md">
        <CardHeader>
          <CardTitle>{name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[hsl(var(--foreground))]">{studentCount} students</p>
        </CardContent>
      </Card>
    </Link>
  );
}
