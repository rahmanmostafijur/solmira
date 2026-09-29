import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { IdentityConfig } from '../config.js';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Port for outgoing email. Locally it points at Mailpit (a mail catcher); in AWS the same SMTP
 * transport targets Amazon SES. Tests substitute an in-memory implementation.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}

/** Without SMTP configured, emails are dropped. Only the subject is logged: bodies carry secret links. */
class DisabledEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  async send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      { subject: message.subject },
      'SMTP_URL is not configured; email was not sent',
    );
  }
}

export function createEmailSender(config: IdentityConfig): EmailSender {
  return config.SMTP_URL
    ? new SmtpEmailSender(config.SMTP_URL, config.MAIL_FROM)
    : new DisabledEmailSender();
}
