export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendSMSArgs {
  phone: string;
  message: string;
}

export interface SendSesTemplatedEmailArgs {
  to: string;
  templateName: string;
  data: Record<string, unknown>;
}

export interface NotificationSender {
  sendEmail(args: SendEmailArgs): Promise<void>;
  sendSMS(args: SendSMSArgs): Promise<void>;
  sendSesTemplatedEmail(args: SendSesTemplatedEmailArgs): Promise<void>;
}

function redactDigitRuns(s: string): string {
  return s.replace(/\d{6}/g, '******');
}

export const mockSender: NotificationSender = {
  async sendEmail(args) {
    console.log('[mock-email]', {
      to: args.to,
      subject: args.subject,
      preview: redactDigitRuns(args.text.slice(0, 80)),
    });
  },
  async sendSMS(args) {
    console.log('[mock-sms]', {
      phone: args.phone,
      preview: redactDigitRuns(args.message.slice(0, 80)),
    });
  },
  async sendSesTemplatedEmail(args) {
    // Keys only, never values: template data carries family names, amounts and
    // invite URLs, and this line goes to the Vercel log.
    console.log('[mock-templated-email]', {
      to: args.to,
      templateName: args.templateName,
      dataKeys: Object.keys(args.data),
    });
  },
};
