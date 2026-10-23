import { formatPillTime, relativeFromNow } from "../../lib/format";
import type { CampaignProgress } from "../../types/email";

export type CampaignState = "scheduled" | "sending" | "throttled" | "completed" | "completed_with_errors";

export function campaignState(c: CampaignProgress): CampaignState {
  const pending = c.counts.scheduled + c.counts.rate_limited + c.counts.sending;
  if (pending === 0) return c.counts.failed > 0 ? "completed_with_errors" : "completed";
  if (c.counts.rate_limited > 0) return "throttled";
  const started = c.counts.sent + c.counts.failed + c.counts.sending > 0;
  if (!started && c.next_send_at && new Date(c.next_send_at).getTime() > Date.now() + 5000) return "scheduled";
  return "sending";
}

export const stateMeta: Record<CampaignState, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300" },
  sending: { label: "Sending", className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300" },
  throttled: { label: "Throttled", className: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" },
  completed: { label: "Completed", className: "border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-600/30 dark:bg-brand-600/15 dark:text-brand-300" },
  completed_with_errors: { label: "Completed with errors", className: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" },
};

/** One human sentence about what happens next. */
export function nextStepText(c: CampaignProgress): string {
  const state = campaignState(c);
  const at = (iso: string) => `${formatPillTime(iso)} (${relativeFromNow(iso)})`;
  switch (state) {
    case "scheduled":
      return `Starts ${at(c.next_send_at!)}`;
    case "throttled":
      return `Hourly limit reached (${c.sent_this_hour}/${c.hourly_limit} this hour). Resumes ${at(c.resumes_at!)}`;
    case "sending":
      return c.next_send_at ? `Next send ${at(c.next_send_at)}` : "Sending…";
    case "completed":
      return c.last_sent_at ? `Finished ${at(c.last_sent_at)}` : "Finished";
    case "completed_with_errors":
      return `${c.counts.failed} failed. Retry them from the Sent tab`;
  }
}
