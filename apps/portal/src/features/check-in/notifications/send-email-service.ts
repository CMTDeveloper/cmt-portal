import 'server-only';
import { renderEmailTemplate, type TemplateName } from '@/lib/aws/render-template';
import { resolveSender } from '@/lib/aws/resolve-sender';

export interface SendTemplatedEmailArgs {
  to: string;
  template: TemplateName;
  props: Record<string, unknown>;
}

export async function sendTemplatedEmail(args: SendTemplatedEmailArgs): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rendered = (renderEmailTemplate as any)(args.template, args.props);
  const sender = resolveSender();
  await sender.sendEmail({
    to: args.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}
