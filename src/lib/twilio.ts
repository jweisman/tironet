import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

function getClient() {
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }
  return twilio(accountSid, authToken);
}

/** Send a WhatsApp OTP via Twilio Verify. */
export async function sendWhatsAppOtp(phoneE164: string): Promise<void> {
  if (!serviceSid) throw new Error("TWILIO_VERIFY_SERVICE_SID not configured");
  await getClient().verify.v2
    .services(serviceSid)
    .verifications.create({ to: phoneE164, channel: "sms" });
}

/** Verify a WhatsApp OTP code. Returns true if approved. */
export async function verifyWhatsAppOtp(
  phoneE164: string,
  code: string
): Promise<boolean> {
  if (!serviceSid) throw new Error("TWILIO_VERIFY_SERVICE_SID not configured");
  const check = await getClient().verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to: phoneE164, code });
  return check.status === "approved";
}

/** Send an SMS via the Twilio Messaging Service. */
export async function sendSms(to: string, body: string): Promise<void> {
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!messagingServiceSid) throw new Error("TWILIO_MESSAGING_SERVICE_SID not configured");
  await getClient().messages.create({ messagingServiceSid, to, body });
}
