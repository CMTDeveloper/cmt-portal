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

export interface NotificationSender {
  sendEmail(args: SendEmailArgs): Promise<void>;
  sendSMS(args: SendSMSArgs): Promise<void>;
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
};
