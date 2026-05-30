interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  numberOfAdults: number;
  numberOfChildren: number;
  checkedInAt: string;
}

interface Props {
  guests: Guest[];
}

function fmtCheckedIn(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Toronto',
  });
}

export function GuestList({ guests }: Props) {
  if (guests.length === 0) {
    return <p className="text-sm text-[hsl(var(--foreground))]">No guests found.</p>;
  }
  return (
    <>
      {/* Mobile: stacked card rows — hidden on md+ */}
      <ul className="block md:hidden" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {guests.map((g, i) => (
          <li
            key={g.id}
            style={{
              padding: '14px 0',
              borderTop: i > 0 ? '1px solid hsl(var(--border))' : undefined,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
              {g.firstName} {g.lastName}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', fontSize: 13 }}>
              {(g.email ?? g.phone) ? (
                <>
                  <span style={labelStyle}>Contact</span>
                  <span style={{ wordBreak: 'break-all' }}>
                    {g.email && <span style={{ display: 'block' }}>{g.email}</span>}
                    {g.phone && <span style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>{g.phone}</span>}
                  </span>
                </>
              ) : null}
              <span style={labelStyle}>Party</span>
              <span>{g.numberOfAdults} adults, {g.numberOfChildren} children</span>
              <span style={labelStyle}>Checked in</span>
              <span>{fmtCheckedIn(g.checkedInAt)}</span>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: full table — hidden below md */}
      <div className="hidden md:block" style={{ overflowX: 'auto' }}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Name</th>
              <th className="p-2">Contact</th>
              <th className="p-2">Party</th>
              <th className="p-2">Checked in</th>
            </tr>
          </thead>
          <tbody>
            {guests.map((g) => (
              <tr key={g.id} className="border-b">
                <td className="p-2">
                  {g.firstName} {g.lastName}
                </td>
                <td className="p-2">
                  <div style={{ wordBreak: 'break-all' }}>{g.email ?? ''}</div>
                  <div className="text-xs">{g.phone ?? ''}</div>
                </td>
                <td className="p-2">
                  {g.numberOfAdults} adults, {g.numberOfChildren} children
                </td>
                <td className="p-2">{new Date(g.checkedInAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  opacity: 0.55,
  whiteSpace: 'nowrap',
  paddingTop: 1,
};
