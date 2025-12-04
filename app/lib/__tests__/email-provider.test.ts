/**
 * Tests for Email Provider Integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EmailService,
  ConsoleEmailProvider,
  ResendEmailProvider,
  SendGridEmailProvider,
  type EmailMessage,
  type EmailRecipient,
} from "../email-provider.server";

// ============================================================================
// Test Helpers
// ============================================================================

const defaultFrom: EmailRecipient = {
  email: "test@cardforum.com",
  name: "Test Sender",
};

const testRecipient: EmailRecipient = {
  email: "customer@example.com",
  name: "Test Customer",
};

const testMessage: EmailMessage = {
  to: testRecipient,
  subject: "Test Email",
  text: "This is a test email",
  html: "<p>This is a test email</p>",
};

// ============================================================================
// ConsoleEmailProvider Tests
// ============================================================================

describe("ConsoleEmailProvider", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should always be configured", () => {
    const provider = new ConsoleEmailProvider();
    expect(provider.isConfigured()).toBe(true);
  });

  it("should log email to console", async () => {
    const provider = new ConsoleEmailProvider();
    const result = await provider.send(testMessage);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("console");
    expect(result.messageId).toMatch(/^console-\d+$/);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("should handle multiple recipients", async () => {
    const provider = new ConsoleEmailProvider();
    const message: EmailMessage = {
      ...testMessage,
      to: [
        { email: "one@example.com" },
        { email: "two@example.com" },
      ],
    };

    const result = await provider.send(message);

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// ResendEmailProvider Tests
// ============================================================================

describe("ResendEmailProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should not be configured without API key", () => {
    const provider = new ResendEmailProvider("", defaultFrom);
    expect(provider.isConfigured()).toBe(false);
  });

  it("should be configured with API key", () => {
    const provider = new ResendEmailProvider("re_test_key", defaultFrom);
    expect(provider.isConfigured()).toBe(true);
  });

  it("should return error if not configured", async () => {
    const provider = new ResendEmailProvider("", defaultFrom);
    const result = await provider.send(testMessage);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Resend API key not configured");
  });

  it("should send email successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "resend_msg_123" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new ResendEmailProvider("re_test_key", defaultFrom);
    const result = await provider.send(testMessage);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("resend_msg_123");
    expect(result.provider).toBe("resend");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer re_test_key",
          "Content-Type": "application/json",
        },
      })
    );
  });

  it("should handle API errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: "Invalid email address" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new ResendEmailProvider("re_test_key", defaultFrom);
    const result = await provider.send(testMessage);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid email address");
  });

  it("should handle network errors", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
    vi.stubGlobal("fetch", mockFetch);

    const provider = new ResendEmailProvider("re_test_key", defaultFrom);
    const result = await provider.send(testMessage);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network timeout");
  });
});

// ============================================================================
// SendGridEmailProvider Tests
// ============================================================================

describe("SendGridEmailProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should not be configured without API key", () => {
    const provider = new SendGridEmailProvider("", defaultFrom);
    expect(provider.isConfigured()).toBe(false);
  });

  it("should be configured with API key", () => {
    const provider = new SendGridEmailProvider("SG.test_key", defaultFrom);
    expect(provider.isConfigured()).toBe(true);
  });

  it("should send email successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "x-message-id": "sg_msg_123" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new SendGridEmailProvider("SG.test_key", defaultFrom);
    const result = await provider.send(testMessage);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("sg_msg_123");
    expect(result.provider).toBe("sendgrid");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.sendgrid.com/v3/mail/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer SG.test_key",
          "Content-Type": "application/json",
        },
      })
    );
  });

  it("should handle API errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({
        errors: [{ message: "Invalid API key" }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new SendGridEmailProvider("SG.invalid", defaultFrom);
    const result = await provider.send(testMessage);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });
});

// ============================================================================
// EmailService Tests
// ============================================================================

describe("EmailService", () => {
  it("should return error if no providers configured", async () => {
    const service = new EmailService(defaultFrom);
    const result = await service.send(testMessage);

    expect(result.success).toBe(false);
    expect(result.error).toBe("No email providers configured");
  });

  it("should add configured providers", () => {
    const service = new EmailService(defaultFrom);
    service.addProvider(new ConsoleEmailProvider());

    expect(service.getProviders()).toContain("console");
  });

  it("should not add unconfigured providers", () => {
    const service = new EmailService(defaultFrom);
    service.addProvider(new ResendEmailProvider("", defaultFrom));

    expect(service.getProviders()).not.toContain("resend");
  });

  it("should send email with first successful provider", async () => {
    const service = new EmailService(defaultFrom);
    service.addProvider(new ConsoleEmailProvider());

    const result = await service.send(testMessage);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("console");
  });

  it("should try next provider on failure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: "Server error" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const service = new EmailService(defaultFrom);

    // Add failing Resend provider first
    service.addProvider(new ResendEmailProvider("re_test_key", defaultFrom));
    // Add working console provider as fallback
    service.addProvider(new ConsoleEmailProvider());

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await service.send(testMessage);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("console");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("resend failed")
    );

    consoleSpy.mockRestore();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("should use default from address", async () => {
    const service = new EmailService(defaultFrom);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const mockProvider: any = {
      name: "mock",
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue({
        success: true,
        messageId: "mock_123",
        provider: "mock",
        timestamp: new Date(),
      }),
    };
    service.addProvider(mockProvider);

    await service.send({ to: testRecipient, subject: "Test", text: "Test" });

    expect(mockProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: defaultFrom,
      })
    );

    consoleSpy.mockRestore();
  });

  it("should send template emails", async () => {
    const service = new EmailService(defaultFrom);
    service.addProvider(new ConsoleEmailProvider());

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await service.sendTemplate(
      "submission_received",
      testRecipient,
      {
        customerName: "John Doe",
        submissionNumber: "TRD-202412-00001",
      }
    );

    expect(result.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("TRD-202412-00001")
    );

    consoleSpy.mockRestore();
  });
});

// ============================================================================
// Template Rendering Tests
// ============================================================================

describe("Email Templates", () => {
  let service: EmailService;
  let sentMessage: EmailMessage | null = null;

  beforeEach(() => {
    sentMessage = null;
    service = new EmailService(defaultFrom);

    const captureProvider: any = {
      name: "capture",
      isConfigured: () => true,
      send: async (msg: EmailMessage) => {
        sentMessage = msg;
        return {
          success: true,
          messageId: "capture_123",
          provider: "capture",
          timestamp: new Date(),
        };
      },
    };
    service.addProvider(captureProvider);
  });

  it("should render submission_received template", async () => {
    await service.sendTemplate("submission_received", testRecipient, {
      customerName: "John",
      submissionNumber: "TRD-001",
    });

    expect(sentMessage?.subject).toBe("Trade-In Received - TRD-001");
    expect(sentMessage?.text).toContain("Hi John");
    expect(sentMessage?.html).toContain("TRD-001");
  });

  it("should render package_received template", async () => {
    await service.sendTemplate("package_received", testRecipient, {
      customerName: "Jane",
      submissionNumber: "TRD-002",
    });

    expect(sentMessage?.subject).toBe("Package Received - TRD-002");
    expect(sentMessage?.text).toContain("grading your cards");
  });

  it("should render grading_complete template with bonus", async () => {
    await service.sendTemplate("grading_complete", testRecipient, {
      customerName: "Mike",
      submissionNumber: "TRD-003",
      finalTotal: 5000,
      bonusAmount: 500,
    });

    expect(sentMessage?.subject).toBe("Grading Complete - TRD-003");
    expect(sentMessage?.text).toContain("£50.00");
    expect(sentMessage?.text).toContain("£5.00");
  });

  it("should render payout_processed template", async () => {
    await service.sendTemplate("payout_processed", testRecipient, {
      customerName: "Sarah",
      submissionNumber: "TRD-004",
      amount: 10000,
      payoutMethod: "STORE_CREDIT",
    });

    expect(sentMessage?.subject).toBe("Payout Processed - TRD-004");
    expect(sentMessage?.text).toContain("£100.00");
    expect(sentMessage?.text).toContain("store credit");
  });

  it("should render submission_cancelled template", async () => {
    await service.sendTemplate("submission_cancelled", testRecipient, {
      customerName: "Tom",
      submissionNumber: "TRD-005",
      reason: "Customer request",
    });

    expect(sentMessage?.subject).toBe("Submission Cancelled - TRD-005");
    expect(sentMessage?.text).toContain("Customer request");
  });

  it("should escape HTML in templates", async () => {
    await service.sendTemplate("submission_received", testRecipient, {
      customerName: "<script>alert('xss')</script>",
      submissionNumber: "TRD-XSS",
    });

    expect(sentMessage?.html).toContain("&lt;script&gt;");
    expect(sentMessage?.html).not.toContain("<script>");
  });
});
