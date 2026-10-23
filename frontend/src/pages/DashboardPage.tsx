import { useCallback, useEffect, useState } from "react";
import { ComposeModal } from "../components/ComposeModal";
import { EmailDetailModal } from "../components/EmailDetailModal";
import { EmailTable } from "../components/EmailTable";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Field";
import { Spinner } from "../components/ui/Spinner";
import { useEmails } from "../hooks/useEmails";
import { useDebounced } from "../hooks/useDebounced";
import { api } from "../lib/api";
import type { EmailItem, EmailStats, ListKind } from "../types/email";

export function DashboardPage() {
  const [tab, setTab] = useState<ListKind>("scheduled");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [selected, setSelected] = useState<EmailItem | null>(null);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const debouncedSearch = useDebounced(search.trim(), 300);
  const list = useEmails(tab, debouncedSearch, refreshKey);

  const loadStats = useCallback(() => api.stats().then(setStats).catch(() => undefined), []);
  // Stats follow the list's polling cadence: refresh whenever list data changes.
  useEffect(() => void loadStats(), [loadStats, list.items, refreshKey]);

  const openCompose = () => setComposeOpen(true);

  return (
    <div className="min-h-full">
      <Header />
      <div className="md:flex">
        <Sidebar active={tab} stats={stats} onSelect={setTab} onCompose={openCompose} />

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">{tab === "scheduled" ? "Scheduled Emails" : "Sent Emails"}</h1>
              <p className="text-sm text-ink-500">
                {list.total} {tab === "scheduled" ? "waiting to be sent" : "sent or failed"}
              </p>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" fill="currentColor">
                  <path d="M8.5 3a5.5 5.5 0 0 1 4.4 8.8l3.7 3.6a1 1 0 0 1-1.5 1.4l-3.6-3.7A5.5 5.5 0 1 1 8.5 3zm0 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
                </svg>
                <Input placeholder="Search email or subject" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Button variant="ghost" size="md" onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh" title="Refresh">
                {list.refreshing ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </Button>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
            <EmailTable
              kind={tab}
              items={list.items}
              loading={list.loading}
              error={list.error}
              searching={!!debouncedSearch}
              onRetry={list.refresh}
              onCompose={openCompose}
              onOpen={setSelected}
            />
            {list.pageCount > 1 && (
              <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-sm">
                <span className="text-ink-500">
                  Page {list.page} of {list.pageCount}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={list.page >= list.pageCount} onClick={() => list.setPage(list.page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onScheduled={() => {
          setTab("scheduled");
          setRefreshKey((k) => k + 1);
        }}
      />
      <EmailDetailModal email={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
