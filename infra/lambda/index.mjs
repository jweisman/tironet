import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { randomUUID } from "crypto";

const s3 = new S3Client({});
const ses = new SESClient({});

const MAIL_BUCKET = process.env.MAIL_BUCKET;
const MAIL_PREFIX = process.env.MAIL_PREFIX || "inbound";
const FORWARD_TO = process.env.FORWARD_TO;
const FROM_EMAIL = process.env.FROM_EMAIL;
const EXPECT_RECIPIENT = process.env.EXPECT_RECIPIENT;

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function wrap76(str) {
  return str.replace(/(.{1,76})/g, "$1\r\n");
}

export const handler = async (event) => {
  console.log(JSON.stringify(event, null, 2));

  const record = event?.Records?.[0];
  const sesMail = record?.ses?.mail;
  const receipt = record?.ses?.receipt;

  if (!sesMail || !receipt) {
    throw new Error("Missing SES payload");
  }

  const messageId = sesMail.messageId;
  const recipients = receipt.recipients || [];
  const originalFrom = sesMail.commonHeaders?.from?.join(", ") || "(unknown sender)";
  const originalSubject = sesMail.commonHeaders?.subject || "(no subject)";

  if (EXPECT_RECIPIENT && !recipients.includes(EXPECT_RECIPIENT)) {
    console.log(`Skipping: recipient mismatch. Got ${recipients.join(", ")}`);
    return { skipped: true };
  }

  const key = `${MAIL_PREFIX}/${messageId}`;
  const s3Object = await s3.send(
    new GetObjectCommand({
      Bucket: MAIL_BUCKET,
      Key: key,
    })
  );

  const rawOriginal = await streamToBuffer(s3Object.Body);

  const boundary = `NextPart_${randomUUID()}`;
  const date = new Date().toUTCString();

  const bodyText =
    `Forwarded inbound email received by SES.\r\n\r\n` +
    `Original From: ${originalFrom}\r\n` +
    `Original To: ${recipients.join(", ")}\r\n` +
    `Original Subject: ${originalSubject}\r\n`;

  const rawEmail = [
    `From: ${FROM_EMAIL}`,
    `To: ${FORWARD_TO}`,
    `Subject: Fwd: ${originalSubject}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    bodyText,
    ``,
    `--${boundary}`,
    `Content-Type: message/rfc822; name="original-message.eml"`,
    `Content-Disposition: attachment; filename="original-message.eml"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrap76(rawOriginal.toString("base64")),
    ``,
    `--${boundary}--`,
    ``
  ].join("\r\n");

  const result = await ses.send(
    new SendRawEmailCommand({
      RawMessage: {
        Data: Buffer.from(rawEmail),
      },
    })
  );

  console.log("Forwarded with SES message ID:", result.MessageId);

  return {
    ok: true,
    forwardedTo: FORWARD_TO,
    sourceMessageId: messageId,
    outboundMessageId: result.MessageId,
  };
};