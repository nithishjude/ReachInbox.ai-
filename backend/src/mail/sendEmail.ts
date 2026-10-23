import nodemailer, { Transporter } from "nodemailer";
import type { EmailRow } from "../db/emails.repo";
import type { SenderRow } from "./senders";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendEmail(
  transport: Transporter,
  sender: SenderRow,
  email: Pick<EmailRow, "id" | "recipient" | "subject" | "body">,
): Promise<{ messageId: string; previewUrl: string | null }> {
  const info = await transport.sendMail({
    from: { name: sender.name, address: sender.email },
    to: email.recipient,
    subject: email.subject,
    text: email.body,
    html: `<div style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(email.body)}</div>`,
    // Deterministic Message-ID: the same email row always produces the same id, which makes any
    // accidental duplicate easy to detect downstream (and lets real providers de-duplicate).
    messageId: `<${email.id}@reachinbox-scheduler.local>`,
    headers: { "X-Email-Id": email.id },
  });
  const preview = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId, previewUrl: typeof preview === "string" ? preview : null };
}
