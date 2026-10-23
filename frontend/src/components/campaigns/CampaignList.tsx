import { AlertTriangle, Layers, RotateCw, SearchX } from "lucide-react";
import { formatShortDateTime } from "../../lib/format";
import type { CampaignProgress } from "../../types/email";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { CampaignProgressBar } from "./CampaignProgressBar";
import { campaignState, nextStepText, stateMeta } from "./campaignState";

interface CampaignListProps {
  items: CampaignProgress[];
  loading: boolean;
  error: string | null;
  filtered: boolean;
  onOpen: (c: CampaignProgress) => void;
  onRetryLoad: () => void;
  onCompose: () => void;
}

export function CampaignList({ items, loading, error, filtered, onOpen, onRetryLoad, onCompose }: CampaignListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-xl border border-line p-5">
            <div className="h-4 w-64 animate-pulse rounded bg-subtle" />
            <div className="mt-4 h-2.5 animate-pulse rounded-full bg-subtle" />
          </div>
        ))}
      </div>
    );
  }
  if (error && items.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load campaigns"
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
    return filtered ? (
      <EmptyState icon={SearchX} title="No matching campaigns" description="Try a different search." />
    ) : (
      <EmptyState
        icon={Layers}
        title="No campaigns yet"
        description="Every time you schedule emails a campaign appears here with live progress."
        action={
          <button onClick={onCompose} className="focus-ring h-10 rounded-full border border-brand-600 px-6 font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-600/10">
            Compose
          </button>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((c) => {
        const state = campaignState(c);
        const done = c.counts.sent + c.counts.failed;
        const pct = Math.round((c.counts.sent / Math.max(1, c.total)) * 100);
        return (
          <li key={c.id}>
            <button
              onClick={() => onOpen(c)}
              className="focus-ring block w-full rounded-xl border border-line p-5 text-left transition-colors hover:border-brand-600/40 hover:bg-subtle/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-medium">{c.subject}</p>
                  <p className="mt-0.5 truncate text-sm text-fg-muted">
                    {c.total} recipient{c.total === 1 ? "" : "s"} · from {c.sender_email} · created {formatShortDateTime(c.created_at)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-sm ${stateMeta[state].className}`}>{stateMeta[state].label}</span>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span>
                    <span className="font-semibold tabular-nums">{c.counts.sent}</span>
                    <span className="text-fg-muted"> / {c.total} sent</span>
                    {done < c.total && <span className="text-fg-subtle"> · {c.total - done} to go</span>}
                  </span>
                  <span className="tabular-nums text-fg-muted">{pct}%</span>
                </div>
                <CampaignProgressBar campaign={c} />
              </div>

              <p className="mt-3 text-sm text-fg-muted">{nextStepText(c)}</p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
