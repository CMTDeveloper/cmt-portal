import { headers } from 'next/headers';

export type SetuSessionHeaders = {
  role: string | null;
  fid: string | null;
  mid: string | null;
  uid: string | null;
};

export async function getSetuSessionHeaders(): Promise<SetuSessionHeaders> {
  const h = await headers();
  return {
    role: h.get('x-portal-role'),
    fid: h.get('x-portal-fid'),
    mid: h.get('x-portal-mid'),
    uid: h.get('x-portal-uid'),
  };
}
