import { formatDateTime, relativeFromNow } from "../lib/format";
import type { EmailItem, ListKind } from "../types/email";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { StatusBadge } from "./ui/StatusBadge";

interface EmailTableProps {
  kind: ListKind;
  items: EmailItem[];
  loading: boolean;
  error: string | null;
  searching: boolean;
  onRetry: () => void;
  onCompose: () => void;
  onOpen: (email: EmailItem) => void;
}

/** Per-tab differences live in this config; the table markup is shared. */
const config: Record<ListKind, { timeLabel: string; time: (e: EmailItem) => string | null; empty: { title: string; description: string } }> = {
  scheduled: {
    timeLabel: "Scheduled time",
    time: (e) => e.next_attempt_at,
    empty: { title: "No scheduled emails", description: "Emails you schedule will wait here until they are sent." },
  },
  sent: {
    timeLabel: "Sent time",
    time: (e) => e.sent_at,
    empty: { title: "No sent emails yet", description: "Once scheduled emails go out, they will show up here." },
  },
};

const headers = (kind: ListKind) => ["Email", "Subject", config[kind].timeLabel, "Status"];

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <tr key={i} className="border-b border-ink-100">
          {[40, 55, 30, 15].map((w, j) => (
            <td key={j} className="px-4 py-4">
              <div className="h-3.5 animate-pulse rounded bg-ink-100" style={{ width: `${w + ((i * 7) % 20)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmailTable({ kind, items, loading, error, searching, onRetry, onCompose, onOpen }: EmailTableProps) {
  const c = config[kind];

  if (error && items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return searching ? (
      <EmptyState title="No matches" description="No emails match your search." />
    ) : (
      <EmptyState
        {...c.empty}
        action={
          kind === "scheduled" ? (
            <Button onClick={onCompose} icon={<span className="text-lg leading-none">+</span>}>
              Compose New Email
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
            {headers(kind).map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows />
          ) : (
            items.map((e) => {
              const time = c.time(e);
              return (
                <tr key={e.id} onClick={() => onOpen(e)} className="cursor-pointer border-b border-ink-100 transition-colors hover:bg-ink-50">
                  <td className="max-w-[240px] px-4 py-3.5">
                    <p className="truncate font-medium">{e.recipient}</p>
                    <p className="truncate text-xs text-ink-500">from {e.sender_email}</p>
                  </td>
                  <td className="max-w-[360px] px-4 py-3.5">
                    <p className="truncate">
                      <span className="font-medium">{e.subject}</span>
                      <span className="text-ink-500"> — {e.body}</span>
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <p>{formatDateTime(time)}</p>
                    {time && <p className="text-xs text-ink-500">{relativeFromNow(time)}</p>}
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={e.status} title={e.error ?? undefined} />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
