import type { EmailItem } from "../types/email";

/** A minute of grace so emails that are being picked up right now don't flicker to "overdue". */
const OVERDUE_GRACE_MS = 60_000;

/** Waiting to send but already past its time (worker stopped, SMTP unreachable, retrying...). */
export function isOverdue(email: Pick<EmailItem, "status" | "next_attempt_at">): boolean {
  return (
    (email.status === "scheduled" || email.status === "sending") &&
    new Date(email.next_attempt_at).getTime() < Date.now() - OVERDUE_GRACE_MS
  );
}

/** Turns low-level SMTP/network errors into a sentence a user can act on. */
export function friendlyError(error: string): string {
  const e = error.toLowerCase();
  if (/timeout|etimedout|econnrefused|enotfound|ehostunreach|econnreset|getaddrinfo/.test(e)) return "Couldn't reach the mail server";
  if (/auth|login|credentials|535|534/.test(e)) return "The mail server rejected the sender's login";
  if (/mid-send/.test(e)) return "The worker stopped while sending, so it wasn't retried (to avoid a duplicate)";
  if (/^5\d\d|rejected|recipient/.test(e)) return "The mail server rejected this email";
  return error;
}
