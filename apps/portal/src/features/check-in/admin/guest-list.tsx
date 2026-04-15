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

export function GuestList({ guests }: Props) {
  if (guests.length === 0) {
    return <p className="text-sm text-[hsl(var(--foreground))]">No guests found.</p>;
  }
  return (
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
              <div>{g.email ?? ''}</div>
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
  );
}
