import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendMail = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: mockSendMail,
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendEmail", () => {
  it("sends email with correct fields", async () => {
    mockSendMail.mockResolvedValue({ messageId: "msg-1" });

    // Dynamic import because createTransport is called at module level
    vi.resetModules();
    const { sendEmail } = await import("../send");

    await sendEmail({
      to: "test@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
    });

    expect(mockSendMail).toHaveBeenCalledWith({
      from: expect.any(String),
      to: "test@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
    });
  });

  it("uses default FROM_EMAIL when env var not set", async () => {
    mockSendMail.mockResolvedValue({});

    vi.resetModules();
    const { sendEmail } = await import("../send");

    await sendEmail({ to: "a@b.com", subject: "s", html: "h" });

    const call = mockSendMail.mock.calls[0][0];
    expect(call.from).toContain("Tironet");
  });
});
