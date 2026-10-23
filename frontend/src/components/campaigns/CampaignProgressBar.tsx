import type { CampaignProgress, EmailStatus } from "../../types/email";

// Stacked segments in "furthest along first" order.
const segments: { status: EmailStatus; label: string; bar: string; dot: string }[] = [
  { status: "sent", label: "Sent", bar: "bg-brand-500", dot: "bg-brand-500" },
  { status: "failed", label: "Failed", bar: "bg-red-500", dot: "bg-red-500" },
  { status: "sending", label: "Sending", bar: "bg-sky-500", dot: "bg-sky-500" },
  { status: "rate_limited", label: "Rate limited", bar: "bg-amber-400", dot: "bg-amber-400" },
  { status: "scheduled", label: "Scheduled", bar: "bg-line", dot: "bg-fg-subtle/50" },
];

export function CampaignProgressBar({
  campaign,
  legend = true,
  height = "h-2.5",
}: {
  campaign: CampaignProgress;
  legend?: boolean;
  height?: string;
}) {
  const total = Math.max(1, campaign.total);
  return (
    <div>
      <div
        className={`flex w-full overflow-hidden rounded-full bg-subtle ${height}`}
        role="img"
        aria-label={`${campaign.counts.sent} of ${campaign.total} sent`}
      >
        {segments.map(({ status, bar }) =>
          campaign.counts[status] > 0 ? (
            <div
              key={status}
              className={`${bar} transition-[width] duration-500`}
              style={{ width: `${(campaign.counts[status] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      {legend && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          {segments.map(({ status, label, dot }) =>
            campaign.counts[status] > 0 ? (
              <span key={status} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {label} <span className="font-medium tabular-nums text-fg">{campaign.counts[status]}</span>
              </span>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
