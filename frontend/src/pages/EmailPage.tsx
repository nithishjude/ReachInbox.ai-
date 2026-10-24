import { AlertCircle, ExternalLink, RotateCw, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Avatar } from "../components/ui/Avatar";
import { Button, buttonClasses } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useAuth } from "../hooks/useAuth";
import { useStarred } from "../hooks/useStarred";
import { useToast } from "../hooks/useToast";
import { api, ApiError } from "../lib/api";
import { friendlyError, isOverdue } from "../lib/emailStatus";
import { formatDateTime, formatShortDateTime, relativeFromNow } from "../lib/format";
import { isHtml, sanitize } from "../lib/html";
import type { EmailItem } from "../types/email";

const iconBtn = "focus-ring rounded-lg p-2 text-fg-subtle transition-colors hover:bg-subtle hover:text-fg disabled:opacity-40";

export function EmailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { isStarred, toggle } = useStarred();
  const [email, setEmail] = useState<EmailItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"retry" | "delete" | null>(null);

  const load = useCallback(
    () =>
      api
        .getEmail(id)
        .then((e) => {
          setEmail(e);
          setError(null);
        })
        .catch((err) =>
          setError(err instanceof ApiError && err.status === 404 ? "This email doesn't exist anymore." : String(err.message)),
        ),
    [id],
  );

  // Poll while the email is still pending so its status updates live.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const back = () => navigate(email && (email.status === "sent" || email.status === "failed") ? "/?tab=sent" : "/");

  const retry = async () => {
    if (!email) return;
    setBusy("retry");
    try {
      await api.retry({ ids: [email.id] });
      toast.success("Email re-queued", email.recipient);
      await load();
    } catch (err) {
      toast.error("Retry failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!email) return;
    setBusy("delete");
    try {
      await api.deleteEmail(email.id);
      toast.success(email.status === "sent" || email.status === "failed" ? "Email deleted" : "Scheduled email cancelled");
      back();
    } catch (err) {
      toast.error("Couldn't delete", err instanceof Error ? err.message : undefined);
      setBusy(null);
    }
  };

  if (error && !email) {
    return (
      <div>
        <PageHeader title="Email" onBack={() => navigate("/")} />
        <EmptyState icon={AlertCircle} title="Email not found" description={error} />
      </div>
    );
  }
  if (!email) {
    return (
      <div className="flex h-full items-center justify-center text-brand-600">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  const starred = isStarred(email.id);
  const pending = email.status !== "sent" && email.status !== "failed";

  return (
    <div className="min-h-full">
      <PageHeader
        title={email.subject}
        onBack={back}
        actions={
          <>
            <button className={iconBtn} onClick={() => toggle(email.id)} aria-label={starred ? "Unstar" : "Star"} aria-pressed={starred}>
              <Star className={`h-5 w-5 ${starred ? "fill-amber-400 text-amber-400" : ""}`} strokeWidth={1.5} />
            </button>
            <button
              className={iconBtn}
              onClick={() => void remove()}
              disabled={busy !== null || email.status === "sending"}
              aria-label={pending ? "Cancel scheduled email" : "Delete email"}
              title={pending ? "Cancel scheduled email" : "Delete"}
            >
              {busy === "delete" ? <Spinner className="h-5 w-5" /> : <Trash2 className="h-5 w-5" strokeWidth={1.5} />}
            </button>
            <span className="h-8 w-px bg-line" />
            {user && <Avatar name={user.name} src={user.avatarUrl} size={40} />}
          </>
        }
      />

      <article className="mx-auto max-w-[1340px] px-5 pb-16">
        <div className="flex items-start gap-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-500 text-lg text-white">
            {email.sender_name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="min-w-0 truncate">
                <span className="text-[17px] font-semibold">{email.sender_name}</span>{" "}
                <span className="text-fg-muted">&lt;{email.sender_email}&gt;</span>
              </p>
              <span className="shrink-0 text-fg-muted">{formatShortDateTime(email.sent_at ?? email.next_attempt_at)}</span>
            </div>
            <p className="mt-0.5 text-fg-muted">to {email.recipient}</p>

            {/* Delivery status */}
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-fg-muted">
              <StatusBadge email={email} />
              {pending &&
                (isOverdue(email) ? (
                  <span>Was due {formatDateTime(email.next_attempt_at)}. Waiting for the worker to send it.</span>
                ) : email.error && email.status === "scheduled" ? (
                  <span>
                    Retrying automatically at {formatDateTime(email.next_attempt_at)} ({relativeFromNow(email.next_attempt_at)})
                  </span>
                ) : (
                  <span>
                    Scheduled for {formatDateTime(email.next_attempt_at)} ({relativeFromNow(email.next_attempt_at)})
                  </span>
                ))}
              {email.status === "rate_limited" && <span>· hourly limit reached, moved to the next hour window</span>}
              {email.status === "sent" && email.sent_at && <span>Sent {formatDateTime(email.sent_at)}</span>}
            </div>
            {email.error && (
              <div
                className={`mt-3 flex gap-2.5 rounded-lg border p-3 text-sm ${
                  email.status === "failed"
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                }`}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">
                  <span className="font-medium">{friendlyError(email.error)}</span>
                  {email.status === "failed"
                    ? ` · gave up after ${email.attempts} attempt${email.attempts === 1 ? "" : "s"}. Use "Retry send" to try again.`
                    : ` · attempt ${email.attempts}${email.max_attempts ? ` of ${email.max_attempts}` : ""}, retrying automatically.`}
                  <span className="mt-1 block text-xs opacity-75">Details: {email.error}</span>
                </span>
              </div>
            )}

            {/* Body */}
            {isHtml(email.body) ? (
              <div className="email-body mt-7 text-[17px] leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitize(email.body) }} />
            ) : (
              <div className="mt-7 whitespace-pre-wrap text-[17px] leading-relaxed">{email.body}</div>
            )}

            {(email.status === "failed" || email.preview_url) && (
              <div className="mt-10 flex flex-wrap gap-3">
                {email.status === "failed" && (
                  <Button
                    variant="secondary"
                    loading={busy === "retry"}
                    onClick={() => void retry()}
                    icon={<RotateCw className="h-4 w-4" />}
                  >
                    Retry send
                  </Button>
                )}
                {email.preview_url && (
                  <a href={email.preview_url} target="_blank" rel="noreferrer" className={buttonClasses("secondary")}>
                    <ExternalLink className="h-4 w-4" />
                    View delivered message (Ethereal)
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
