export class LastManagerError extends Error {
  constructor(op: 'remove' | 'demote') {
    super(`Cannot ${op} the last manager`);
    this.name = 'LastManagerError';
  }
}

export function assertNotLastManager(
  family: { managers: string[] },
  mid: string,
  op: 'remove' | 'demote',
): void {
  if (family.managers.includes(mid) && family.managers.length === 1) {
    throw new LastManagerError(op);
  }
}
