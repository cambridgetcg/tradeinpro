/**
 * Email Provider Integration
 *
 * Provides a unified interface for sending transactional emails.
 * Supports multiple providers with fallback capability.
 */

// ============================================================================
// Types
// ============================================================================

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface EmailMessage {
  to: EmailRecipient | EmailRecipient[];
  subject: string;
  text?: string;
  html?: string;
  from?: EmailRecipient;
  replyTo?: EmailRecipient;
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  attachments?: EmailAttachment[];
  metadata?: Record<string, string>;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
  timestamp: Date;
}

export interface EmailProviderConfig {
  name: string;
  apiKey?: string;
  apiUrl?: string;
  from: EmailRecipient;
  enabled: boolean;
}

export interface EmailProvider {
  name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
  isConfigured(): boolean;
}

// ============================================================================
// Template Types
// ============================================================================

export type EmailTemplate =
  | "submission_received"
  | "submission_shipped"
  | "package_received"
  | "grading_complete"
  | "payout_processed"
  | "submission_cancelled"
  | "items_returned"
  | "quote_ready";

export interface TemplateData {
  customerName: string;
  submissionNumber: string;
  [key: string]: unknown;
}

// ============================================================================
// Console Provider (Development/Testing)
// ============================================================================

export class ConsoleEmailProvider implements EmailProvider {
  name = "console";

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    const recipientList = recipients.map((r) => r.email).join(", ");

    console.log("================== EMAIL SENT ==================");
    console.log(`To: ${recipientList}`);
    console.log(`Subject: ${message.subject}`);
    console.log(`From: ${message.from?.email || "noreply@cardforum.com"}`);
    if (message.text) {
      console.log("--- Text Content ---");
      console.log(message.text.slice(0, 500));
    }
    console.log("================================================");

    return {
      success: true,
      messageId: `console-${Date.now()}`,
      provider: this.name,
      timestamp: new Date(),
    };
  }

  isConfigured(): boolean {
    return true;
  }
}

// ============================================================================
// Resend Provider
// ============================================================================

export class ResendEmailProvider implements EmailProvider {
  name = "resend";
  private apiKey: string;
  private fromEmail: EmailRecipient;

  constructor(apiKey: string, fromEmail: EmailRecipient) {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "Resend API key not configured",
        provider: this.name,
        timestamp: new Date(),
      };
    }

    try {
      const recipients = Array.isArray(message.to) ? message.to : [message.to];

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: formatEmailAddress(message.from || this.fromEmail),
          to: recipients.map((r) => formatEmailAddress(r)),
          subject: message.subject,
          text: message.text,
          html: message.html,
          reply_to: message.replyTo
            ? formatEmailAddress(message.replyTo)
            : undefined,
          cc: message.cc?.map((r) => formatEmailAddress(r)),
          bcc: message.bcc?.map((r) => formatEmailAddress(r)),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}`,
          provider: this.name,
          timestamp: new Date(),
        };
      }

      const data = await response.json();

      return {
        success: true,
        messageId: data.id,
        provider: this.name,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        provider: this.name,
        timestamp: new Date(),
      };
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }
}

// ============================================================================
// SendGrid Provider
// ============================================================================

export class SendGridEmailProvider implements EmailProvider {
  name = "sendgrid";
  private apiKey: string;
  private fromEmail: EmailRecipient;

  constructor(apiKey: string, fromEmail: EmailRecipient) {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "SendGrid API key not configured",
        provider: this.name,
        timestamp: new Date(),
      };
    }

    try {
      const recipients = Array.isArray(message.to) ? message.to : [message.to];

      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: recipients.map((r) => ({
                email: r.email,
                name: r.name,
              })),
              cc: message.cc?.map((r) => ({ email: r.email, name: r.name })),
              bcc: message.bcc?.map((r) => ({ email: r.email, name: r.name })),
            },
          ],
          from: {
            email: (message.from || this.fromEmail).email,
            name: (message.from || this.fromEmail).name,
          },
          reply_to: message.replyTo
            ? { email: message.replyTo.email, name: message.replyTo.name }
            : undefined,
          subject: message.subject,
          content: [
            message.text ? { type: "text/plain", value: message.text } : null,
            message.html ? { type: "text/html", value: message.html } : null,
          ].filter(Boolean),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error:
            errorData.errors?.[0]?.message || `HTTP ${response.status}`,
          provider: this.name,
          timestamp: new Date(),
        };
      }

      // SendGrid returns message ID in headers
      const messageId = response.headers.get("x-message-id") || undefined;

      return {
        success: true,
        messageId,
        provider: this.name,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        provider: this.name,
        timestamp: new Date(),
      };
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }
}

// ============================================================================
// Email Service (Main Interface)
// ============================================================================

export class EmailService {
  private providers: EmailProvider[] = [];
  private defaultFrom: EmailRecipient;

  constructor(defaultFrom: EmailRecipient) {
    this.defaultFrom = defaultFrom;
  }

  addProvider(provider: EmailProvider): void {
    if (provider.isConfigured()) {
      this.providers.push(provider);
    }
  }

  getProviders(): string[] {
    return this.providers.map((p) => p.name);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.providers.length === 0) {
      return {
        success: false,
        error: "No email providers configured",
        timestamp: new Date(),
      };
    }

    // Ensure from address is set
    const fullMessage: EmailMessage = {
      ...message,
      from: message.from || this.defaultFrom,
    };

    // Try each provider in order until one succeeds
    for (const provider of this.providers) {
      const result = await provider.send(fullMessage);
      if (result.success) {
        return result;
      }
      // Log the failure but try next provider
      console.warn(`Email provider ${provider.name} failed: ${result.error}`);
    }

    // All providers failed
    return {
      success: false,
      error: "All email providers failed",
      timestamp: new Date(),
    };
  }

  async sendTemplate(
    template: EmailTemplate,
    to: EmailRecipient,
    data: TemplateData
  ): Promise<EmailSendResult> {
    const { subject, text, html } = renderTemplate(template, data);

    return this.send({
      to,
      subject,
      text,
      html,
    });
  }
}

// ============================================================================
// Template Rendering
// ============================================================================

interface RenderedTemplate {
  subject: string;
  text: string;
  html: string;
}

function renderTemplate(
  template: EmailTemplate,
  data: TemplateData
): RenderedTemplate {
  const templates: Record<EmailTemplate, () => RenderedTemplate> = {
    submission_received: () => ({
      subject: `Trade-In Received - ${data.submissionNumber}`,
      text: `Hi ${data.customerName},

We've received your trade-in submission ${data.submissionNumber}.

We'll notify you once we've received your package and started the grading process.

Thanks for choosing CardForum!`,
      html: `
<h2>Trade-In Received</h2>
<p>Hi ${escapeHtml(data.customerName)},</p>
<p>We've received your trade-in submission <strong>${escapeHtml(data.submissionNumber)}</strong>.</p>
<p>We'll notify you once we've received your package and started the grading process.</p>
<p>Thanks for choosing CardForum!</p>
      `.trim(),
    }),

    submission_shipped: () => ({
      subject: `Package Shipped - ${data.submissionNumber}`,
      text: `Hi ${data.customerName},

Your trade-in package for submission ${data.submissionNumber} has been marked as shipped.

Tracking Number: ${data.trackingNumber || "Not available"}

We'll notify you once we receive your package.

Thanks for choosing CardForum!`,
      html: `
<h2>Package Shipped</h2>
<p>Hi ${escapeHtml(data.customerName)},</p>
<p>Your trade-in package for submission <strong>${escapeHtml(data.submissionNumber)}</strong> has been marked as shipped.</p>
<p><strong>Tracking Number:</strong> ${escapeHtml(String(data.trackingNumber || "Not available"))}</p>
<p>We'll notify you once we receive your package.</p>
<p>Thanks for choosing CardForum!</p>
      `.trim(),
    }),

    package_received: () => ({
      subject: `Package Received - ${data.submissionNumber}`,
      text: `Hi ${data.customerName},

Great news! We've received your package for submission ${data.submissionNumber}.

Our team will now begin grading your cards. This typically takes 2-3 business days.

We'll notify you once grading is complete.

Thanks for choosing CardForum!`,
      html: `
<h2>Package Received</h2>
<p>Hi ${escapeHtml(data.customerName)},</p>
<p>Great news! We've received your package for submission <strong>${escapeHtml(data.submissionNumber)}</strong>.</p>
<p>Our team will now begin grading your cards. This typically takes 2-3 business days.</p>
<p>We'll notify you once grading is complete.</p>
<p>Thanks for choosing CardForum!</p>
      `.trim(),
    }),

    grading_complete: () => ({
      subject: `Grading Complete - ${data.submissionNumber}`,
      text: `Hi ${data.customerName},

We've finished grading your cards for submission ${data.submissionNumber}.

Final Value: £${((data.finalTotal as number) / 100).toFixed(2)}
${data.bonusAmount ? `Store Credit Bonus: £${((data.bonusAmount as number) / 100).toFixed(2)}` : ""}

Please log in to review and approve your trade-in.

Thanks for choosing CardForum!`,
      html: `
<h2>Grading Complete</h2>
<p>Hi ${escapeHtml(data.customerName)},</p>
<p>We've finished grading your cards for submission <strong>${escapeHtml(data.submissionNumber)}</strong>.</p>
<p><strong>Final Value:</strong> £${((data.finalTotal as number) / 100).toFixed(2)}</p>
${data.bonusAmount ? `<p><strong>Store Credit Bonus:</strong> £${((data.bonusAmount as number) / 100).toFixed(2)}</p>` : ""}
<p>Please log in to review and approve your trade-in.</p>
<p>Thanks for choosing CardForum!</p>
      `.trim(),
    }),

    payout_processed: () => ({
      subject: `Payout Processed - ${data.submissionNumber}`,
      text: `Hi ${data.customerName},

Your payout for submission ${data.submissionNumber} has been processed!

Amount: £${((data.amount as number) / 100).toFixed(2)}
Method: ${data.payoutMethod || "Store Credit"}

${data.payoutMethod === "STORE_CREDIT" ? "Your store credit is now available in your account." : "Please allow 3-5 business days for the transfer to complete."}

Thanks for choosing CardForum!`,
      html: `
<h2>Payout Processed</h2>
<p>Hi ${escapeHtml(data.customerName)},</p>
<p>Your payout for submission <strong>${escapeHtml(data.submissionNumber)}</strong> has been processed!</p>
<p><strong>Amount:</strong> £${((data.amount as number) / 100).toFixed(2)}</p>
<p><strong>Method:</strong> ${escapeHtml(String(data.payoutMethod || "Store Credit"))}</p>
<p>${data.payoutMethod === "STORE_CREDIT" ? "Your store credit is now available in your account." : "Please allow 3-5 business days for the transfer to complete."}</p>
<p>Thanks for choosing CardForum!</p>
      `.trim(),
    }),

    submission_cancelled: () => ({
      subject: `Submission Cancelled - ${data.submissionNumber}`,
      text: `Hi ${data.customerName},

Your trade-in submission ${data.submissionNumber} has been cancelled.

${data.reason ? `Reason: ${data.reason}` : ""}

If you have any questions, please contact our support team.

Thanks for choosing CardForum!`,
      html: `
<h2>Submission Cancelled</h2>
<p>Hi ${escapeHtml(data.customerName)},</p>
<p>Your trade-in submission <strong>${escapeHtml(data.submissionNumber)}</strong> has been cancelled.</p>
${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(String(data.reason))}</p>` : ""}
<p>If you have any questions, please contact our support team.</p>
<p>Thanks for choosing CardForum!</p>
      `.trim(),
    }),

    items_returned: () => ({
      subject: `Items Being Returned - ${data.submissionNumber}`,
      text: `Hi ${data.customerName},

We're returning your cards from submission ${data.submissionNumber}.

${data.trackingNumber ? `Tracking Number: ${data.trackingNumber}` : "A tracking number will be provided once shipped."}

${data.reason ? `Reason: ${data.reason}` : ""}

Thanks for choosing CardForum!`,
      html: `
<h2>Items Being Returned</h2>
<p>Hi ${escapeHtml(data.customerName)},</p>
<p>We're returning your cards from submission <strong>${escapeHtml(data.submissionNumber)}</strong>.</p>
<p>${data.trackingNumber ? `<strong>Tracking Number:</strong> ${escapeHtml(String(data.trackingNumber))}` : "A tracking number will be provided once shipped."}</p>
${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(String(data.reason))}</p>` : ""}
<p>Thanks for choosing CardForum!</p>
      `.trim(),
    }),

    quote_ready: () => ({
      subject: `Quote Ready - ${data.submissionNumber}`,
      text: `Hi ${data.customerName},

Your quote for submission ${data.submissionNumber} is ready!

Quoted Value: £${((data.quotedTotal as number) / 100).toFixed(2)}
Items: ${data.itemCount}

Submit your cards now to lock in this quote.

Thanks for choosing CardForum!`,
      html: `
<h2>Quote Ready</h2>
<p>Hi ${escapeHtml(data.customerName)},</p>
<p>Your quote for submission <strong>${escapeHtml(data.submissionNumber)}</strong> is ready!</p>
<p><strong>Quoted Value:</strong> £${((data.quotedTotal as number) / 100).toFixed(2)}</p>
<p><strong>Items:</strong> ${data.itemCount}</p>
<p>Submit your cards now to lock in this quote.</p>
<p>Thanks for choosing CardForum!</p>
      `.trim(),
    }),
  };

  return templates[template]();
}

// ============================================================================
// Helpers
// ============================================================================

function formatEmailAddress(recipient: EmailRecipient): string {
  if (recipient.name) {
    return `${recipient.name} <${recipient.email}>`;
  }
  return recipient.email;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

// ============================================================================
// Factory Function
// ============================================================================

export function createEmailService(): EmailService {
  const defaultFrom: EmailRecipient = {
    email: process.env.EMAIL_FROM || "noreply@cardforum.com",
    name: process.env.EMAIL_FROM_NAME || "CardForum Trade-In",
  };

  const service = new EmailService(defaultFrom);

  // Add Resend provider if configured
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    service.addProvider(new ResendEmailProvider(resendKey, defaultFrom));
  }

  // Add SendGrid provider if configured
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (sendgridKey) {
    service.addProvider(new SendGridEmailProvider(sendgridKey, defaultFrom));
  }

  // Always add console provider as fallback in development
  if (process.env.NODE_ENV !== "production") {
    service.addProvider(new ConsoleEmailProvider());
  }

  return service;
}

// Default service instance
export const emailService = createEmailService();
