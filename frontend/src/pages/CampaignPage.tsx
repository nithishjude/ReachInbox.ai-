import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CampaignProgressBar } from "../components/campaigns/CampaignProgressBar";
import { campaignState, nextStepText, stateMeta } from "../components/campaigns/campaignState";
import { EmailList } from "../components/EmailList";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { usePolling } from "../hooks/usePolling";
import { useStarred } from "../hooks/useStarred";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-0.5 text-[15px] font-medium tabular-nums">{value}</p>
    </div>
  );
}

/** Live progress of one campaign: state, progress bar, throttle info and every recipient in send order. */
export function CampaignPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { isStarred, toggle } = useStarred();
  const { data, loading, error, refresh } = usePolling(() => api.campaign(id), id);
  const back = () => navigate("/?tab=campaigns");

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center text-brand-600">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <PageHeader title="Campaign" onBack={back} />
        <EmptyState icon={AlertCircle} title="Campaign not found" description={error ?? "It may have been deleted."} />
      </div>
    );
  }

  const { campaign: c, emails } = data;
  const state = campaignState(c);
  const pct = Math.round((c.counts.sent / Math.max(1, c.total)) * 100);

  return (
    <div className="min-h-full pb-12">
      <PageHeader title={c.subject} onBack={back} />

      <div className="mx-auto max-w-[1340px] space-y-6 px-5">
        <section className="rounded-xl border border-line p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-semibold tabular-nums">{pct}%</span>
              <span className="text-fg-muted">
                {c.counts.sent} of {c.total} sent
              </span>
            </div>
            <span className={`rounded-full border px-3 py-1 text-sm ${stateMeta[state].className}`}>{stateMeta[state].label}</span>
          </div>

          <div className="mt-4">
            <CampaignProgressBar campaign={c} height="h-3" />
          </div>
          <p className="mt-3 text-sm text-fg-muted">{nextStepText(c)}</p>

          <div className="mt-6 grid grid-cols-2 gap-5 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Sender" value={<span className="block truncate" title={c.sender_email}>{c.sender_email}</span>} />
            <Stat label="Hourly limit" value={`${c.sent_this_hour} / ${c.hourly_limit} this hour`} />
            <Stat label="Delay" value={`${c.delay_ms / 1000}s between emails`} />
            <Stat label="Start" value={formatDateTime(c.start_at)} />
            <Stat label="First sent" value={formatDateTime(c.first_sent_at)} />
            <Stat label="Last sent" value={formatDateTime(c.last_sent_at)} />
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-medium text-fg-muted">Recipients in send order</h2>
          <EmailList
            kind="sent"
            items={emails}
            loading={false}
            error={null}
            filtered={false}
            isStarred={isStarred}
            onToggleStar={toggle}
            onOpen={(e) => navigate(`/email/${e.id}`)}
            onRetryLoad={refresh}
            onCompose={() => navigate("/compose")}
          />
        </section>
      </div>
    </div>
  );
}
