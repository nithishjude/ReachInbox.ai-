import type { EmailStatus } from "../../types/email";

const styles: Record<EmailStatus, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  rate_limited: { label: "Rate limited", className: "bg-orange-50 text-orange-700 ring-orange-200" },
  sending: { label: "Sending", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  sent: { label: "Sent", className: "bg-brand-50 text-brand-700 ring-brand-100" },
  failed: { label: "Failed", className: "bg-red-50 text-red-700 ring-red-200" },
};

export function StatusBadge({ status, title }: { status: EmailStatus; title?: string }) {
  const s = styles[status];
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}
