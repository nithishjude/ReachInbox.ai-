import nodemailer, { Transporter } from "nodemailer";
import type { EmailRow } from "../db/emails.repo";
import type { SenderRow } from "./senders";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bodies written in the rich-text editor are HTML; older/API bodies may be plain text. */
export const isHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s);

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/blockquote)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail(
  transport: Transporter,
  sender: SenderRow,
  email: Pick<EmailRow, "id" | "recipient" | "subject" | "body">,
): Promise<{ messageId: string; previewUrl: string | null }> {
  const html = isHtml(email.body) ? email.body : `<div style="white-space:pre-wrap">${escapeHtml(email.body)}</div>`;
  const info = await transport.sendMail({
    from: { name: sender.name, address: sender.email },
    to: email.recipient,
    subject: email.subject,
    text: isHtml(email.body) ? htmlToText(email.body) : email.body,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${html}</div>`,
    // Deterministic Message-ID: the same email row always produces the same id, which makes any
    // accidental duplicate easy to detect downstream (and lets real providers de-duplicate).
    messageId: `<${email.id}@reachinbox-scheduler.local>`,
    headers: { "X-Email-Id": email.id },
  });
  const preview = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId, previewUrl: typeof preview === "string" ? preview : null };
}
