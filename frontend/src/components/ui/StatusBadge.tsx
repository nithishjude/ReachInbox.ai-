import { Clock3, Hourglass, Loader2, type LucideIcon } from "lucide-react";
import { isOverdue } from "../../lib/emailStatus";
import { formatPillTime } from "../../lib/format";
import type { EmailItem, EmailStatus } from "../../types/email";

const styles: Record<EmailStatus, { className: string; icon?: LucideIcon; label?: string }> = {
  // Figma: orange pill with clock + send time for scheduled emails, grey "Sent" pill for sent ones.
  scheduled: {
    icon: Clock3,
    className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  },
  rate_limited: {
    icon: Hourglass,
    className: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  },
  sending: {
    icon: Loader2,
    label: "Sending",
    className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  },
  sent: { label: "Sent", className: "border-transparent bg-subtle text-fg-muted" },
  failed: {
    label: "Failed",
    className: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  },
};

/** Status pill used in list rows and the email view. Pending emails show their (next) send time. */
export function StatusBadge({ email }: { email: Pick<EmailItem, "status" | "next_attempt_at" | "error"> }) {
  const overdue = isOverdue(email);
  const { className, icon: Icon, label } = overdue ? styles.rate_limited : styles[email.status];
  // A past time reads like a bug; say what is actually happening instead.
  const text = overdue ? (email.error ? "Retrying…" : "Waiting to send") : (label ?? formatPillTime(email.next_attempt_at));
  const title =
    email.status === "rate_limited"
      ? "Hourly limit reached; moved to the next hour window"
      : email.status === "failed"
        ? (email.error ?? undefined)
        : undefined;
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm ${className}`}
    >
      {Icon && <Icon className={`h-3.5 w-3.5 ${email.status === "sending" ? "animate-spin" : ""}`} strokeWidth={2} />}
      {text}
    </span>
  );
}
