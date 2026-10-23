import { AlertTriangle, CalendarClock, Inbox, RotateCw, SearchX, Star } from "lucide-react";
import { toPlainText } from "../lib/html";
import { formatShortDateTime } from "../lib/format";
import type { EmailItem, ListKind } from "../types/email";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { StatusBadge } from "./ui/StatusBadge";

interface EmailListProps {
  kind: ListKind;
  items: EmailItem[];
  loading: boolean;
  error: string | null;
  filtered: boolean;
  isStarred: (id: string) => boolean;
  onToggleStar: (id: string) => void;
  onOpen: (email: EmailItem) => void;
  onRetryLoad: () => void;
  onCompose: () => void;
}

const empty: Record<ListKind, { title: string; description: string }> = {
  scheduled: {
    title: "No scheduled emails",
    description: "Compose an email and upload your leads. They'll wait here until it's their turn to send.",
  },
  sent: { title: "No sent emails yet", description: "Once scheduled emails go out, they'll appear here with their delivery status." },
};

const row = "flex items-center gap-4 border-b border-line px-7 py-5";

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={row}>
          <div className="h-4 w-40 animate-pulse rounded bg-subtle" />
          <div className="h-6 w-28 animate-pulse rounded-full bg-subtle" />
          <div className="h-4 animate-pulse rounded bg-subtle" style={{ width: `${30 + ((i * 11) % 30)}%` }} />
        </div>
      ))}
    </>
  );
}

export function EmailList({
  kind,
  items,
  loading,
  error,
  filtered,
  isStarred,
  onToggleStar,
  onOpen,
  onRetryLoad,
  onCompose,
}: EmailListProps) {
  if (loading) return <SkeletonRows />;

  if (error && items.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load emails"
        description={error}
        action={
          <Button variant="secondary" onClick={onRetryLoad} icon={<RotateCw className="h-4 w-4" />}>
            Try again
          </Button>
        }
      />
    );
  }

  if (items.length === 0) {
    if (filtered) return <EmptyState icon={SearchX} title="No matching emails" description="Try a different search or filter." />;
    return (
      <EmptyState
        icon={kind === "scheduled" ? CalendarClock : Inbox}
        {...empty[kind]}
        action={
          kind === "scheduled" ? (
            <button
              onClick={onCompose}
              className="focus-ring h-10 rounded-full border border-brand-600 px-6 font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-600/10"
            >
              Compose
            </button>
          ) : undefined
        }
      />
    );
  }

  return (
    <ul>
      {items.map((e) => {
        const starred = isStarred(e.id);
        return (
          <li
            key={e.id}
            tabIndex={0}
            onClick={() => onOpen(e)}
            onKeyDown={(ev) => ev.key === "Enter" && onOpen(e)}
            className={`${row} group cursor-pointer outline-none transition-colors hover:bg-subtle/50 focus-visible:bg-subtle/50`}
          >
            <p className="w-64 shrink-0 truncate text-[17px] max-md:w-36" title={e.recipient}>
              To: {e.recipient}
            </p>
            <StatusBadge email={e} />
            <p className="min-w-0 flex-1 truncate text-[17px]">
              <span>{e.subject}</span>
              <span className="text-fg-subtle"> - {toPlainText(e.body)}</span>
            </p>
            {kind === "sent" && e.sent_at && (
              <span className="hidden shrink-0 text-sm tabular-nums text-fg-subtle lg:inline">{formatShortDateTime(e.sent_at)}</span>
            )}
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                onToggleStar(e.id);
              }}
              aria-label={starred ? "Unstar" : "Star"}
              aria-pressed={starred}
              className="focus-ring shrink-0 rounded p-1 text-fg-subtle hover:text-amber-500"
            >
              <Star className={`h-5 w-5 ${starred ? "fill-amber-400 text-amber-400" : ""}`} strokeWidth={1.5} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
