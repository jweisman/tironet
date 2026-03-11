import nodemailer from "nodemailer";

// Reuse the same EMAIL_SERVER config as NextAuth's Nodemailer provider.
// Value can be an SMTP URL (smtp://user:pass@host:port) or connection object.
const transporter = nodemailer.createTransport(process.env.EMAIL_SERVER as string);

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  await transporter.sendMail({
    from: process.env.FROM_EMAIL ?? "Tironet <noreply@localhost>",
    to,
    subject,
    html,
  });
}
