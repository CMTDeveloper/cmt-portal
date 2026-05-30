'use client';
import { useState } from 'react';
import { DeleteAdminButton } from './delete-admin-button';

interface AdminUser {
  uid: string;
  email: string;
}

interface Props {
  users: AdminUser[];
  currentUid: string;
}

export function AdminUserList({ users, currentUid }: Props) {
  const [list, setList] = useState(users);

  return (
    <ul className="flex flex-col gap-2">
      {list.map((u) => (
        <li
          key={u.uid}
          className="flex items-center justify-between rounded border border-[hsl(var(--border))] p-3"
        >
          <div className="min-w-0">
            <div className="font-medium break-all">{u.email}</div>
            <div className="text-xs text-[hsl(var(--foreground))]"><code className="break-all">{u.uid}</code></div>
          </div>
          <DeleteAdminButton
            uid={u.uid}
            disabled={u.uid === currentUid}
            onDone={() => setList((prev) => prev.filter((x) => x.uid !== u.uid))}
          />
        </li>
      ))}
    </ul>
  );
}
