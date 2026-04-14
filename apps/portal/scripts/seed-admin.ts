import { z } from 'zod';
import { getOrCreateAdminUser } from '@cmt/firebase-shared/admin/claims';

const inputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

export async function seedAdmin(input: { email: string; password: string }) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  }
  const user = await getOrCreateAdminUser(parsed.data.email, parsed.data.password);
  return { uid: user.uid, email: user.email ?? parsed.data.email };
}

async function main() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) args.set(match[1]!, match[2]!);
  }
  const email = args.get('email');
  if (!email) {
    console.error('usage: pnpm seed:admin --email=<email>');
    process.exit(1);
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question('Password (min 8 chars): ');
  rl.close();

  try {
    const result = await seedAdmin({ email, password });
    console.log(`Admin seeded: ${result.uid} ${result.email}`);
    process.exit(0);
  } catch (err) {
    console.error(`seed-admin failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
