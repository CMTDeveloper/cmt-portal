import { Card, CardContent, CardHeader, CardTitle } from '@cmt/ui';

interface Props {
  title: string;
  value: number | string;
  hint?: string;
}

export function StatCard({ title, value, hint }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-[hsl(var(--foreground))]">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-[hsl(var(--heading))]">{value}</div>
        {hint && <p className="text-xs text-[hsl(var(--foreground))]">{hint}</p>}
      </CardContent>
    </Card>
  );
}
