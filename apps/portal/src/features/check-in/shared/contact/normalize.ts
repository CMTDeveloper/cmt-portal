export function normalizeContact(type: 'email' | 'phone', value: string): string {
  if (type === 'email') return value.trim().toLowerCase();
  return value.replace(/\D/g, '');
}
