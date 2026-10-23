import type { ReactNode } from "react";
import { formatDateTime } from "../lib/format";
import type { EmailItem } from "../types/email";
import { Modal } from "./ui/Modal";
import { StatusBadge } from "./ui/StatusBadge";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function EmailDetailModal({ email, onClose }: { email: EmailItem | null; onClose: () => void }) {
  return (
    <Modal open={!!email} title={email?.subject ?? ""} onClose={onClose}>
      {email && (
        <>
          <dl className="mb-5">
            <Row label="To">{email.recipient}</Row>
            <Row label="From">
              {email.sender_name} &lt;{email.sender_email}&gt;
            </Row>
            <Row label="Status">
              <StatusBadge status={email.status} />
            </Row>
            <Row label="Requested for">{formatDateTime(email.scheduled_at)}</Row>
            {email.status !== "sent" && email.status !== "failed" && <Row label="Next attempt">{formatDateTime(email.next_attempt_at)}</Row>}
            {email.sent_at && <Row label={email.status === "failed" ? "Failed at" : "Sent at"}>{formatDateTime(email.sent_at)}</Row>}
            {email.error && <Row label="Error">{<span className="text-red-600">{email.error}</span>}</Row>}
            {email.preview_url && (
              <Row label="Ethereal">
                <a href={email.preview_url} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
                  Open message preview ↗
                </a>
              </Row>
            )}
          </dl>
          <div className="whitespace-pre-wrap rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm leading-relaxed">{email.body}</div>
        </>
      )}
    </Modal>
  );
}
