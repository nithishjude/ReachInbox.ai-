import { ChevronLeft, ChevronRight, Menu, RefreshCw, RotateCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EmailList } from "../components/EmailList";
import { FilterMenu, type StatusFilter } from "../components/FilterMenu";
import { Sidebar } from "../components/Sidebar";
import { Button } from "../components/ui/Button";
import { useDebounced } from "../hooks/useDebounced";
import { PAGE_SIZE, useEmails } from "../hooks/useEmails";
import { useStarred } from "../hooks/useStarred";
import { useToast } from "../hooks/useToast";
import { api } from "../lib/api";
import type { EmailStats, ListKind } from "../types/email";

export function DashboardPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: ListKind = params.get("tab") === "sent" ? "sent" : "scheduled";

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [retryingAll, setRetryingAll] = useState(false);
  const { isStarred, toggle } = useStarred();

  const debouncedSearch = useDebounced(search.trim(), 300);
  const list = useEmails({ kind: tab, status: filter === "all" ? undefined : filter, search: debouncedSearch, refreshKey });
  const refresh = () => setRefreshKey((k) => k + 1);

  const loadStats = useCallback(() => api.stats().then(setStats).catch(() => undefined), []);
  // Stats follow the list's polling: refresh whenever list data changes.
  useEffect(() => void loadStats(), [loadStats, list.items, refreshKey]);

  const selectTab = (kind: ListKind) => {
    setParams(kind === "sent" ? { tab: "sent" } : {});
    setFilter("all");
    setMenuOpen(false);
  };
  const compose = () => navigate("/compose");

  const retryAll = async () => {
    setRetryingAll(true);
    try {
      const { retried } = await api.retry({ all: true });
      toast.success(`${retried} failed email${retried === 1 ? "" : "s"} re-queued`);
      refresh();
    } catch (err) {
      toast.error("Retry failed", err instanceof Error ? err.message : undefined);
    } finally {
      setRetryingAll(false);
    }
  };

  const failed = stats?.byStatus.failed ?? 0;
  const sidebar = <Sidebar active={tab} stats={stats} onSelect={selectTab} onCompose={compose} />;

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-80 shrink-0 overflow-y-auto lg:block">{sidebar}</aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onMouseDown={() => setMenuOpen(false)}>
          <aside className="animate-fade-in h-full w-80 bg-surface shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 lg:pl-2 lg:pr-6">
        {/* Search + filter + refresh */}
        <div className="flex items-center gap-3 lg:gap-5">
          <button onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-fg-muted hover:bg-subtle lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-subtle px-5 lg:max-w-[840px]">
            <Search className="h-5 w-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Search emails"
              className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-fg-subtle"
            />
          </label>
          <FilterMenu kind={tab} value={filter} onChange={setFilter} />
          <button onClick={refresh} aria-label="Refresh" className="focus-ring rounded-lg p-2 text-fg-muted hover:bg-subtle">
            <RefreshCw className={`h-5 w-5 ${list.refreshing ? "animate-spin" : ""}`} strokeWidth={1.5} />
          </button>
        </div>

        {tab === "sent" && failed > 0 && filter !== "sent" && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <span>
              {failed} email{failed === 1 ? "" : "s"} failed to send.
            </span>
            <Button variant="secondary" size="sm" loading={retryingAll} onClick={() => void retryAll()} icon={<RotateCw className="h-3.5 w-3.5" />}>
              Retry all failed
            </Button>
          </div>
        )}

        <section className="mt-6">
          <EmailList
            kind={tab}
            items={list.items}
            loading={list.loading}
            error={list.error}
            filtered={!!debouncedSearch || filter !== "all"}
            isStarred={isStarred}
            onToggleStar={toggle}
            onOpen={(e) => navigate(`/email/${e.id}`)}
            onRetryLoad={list.refresh}
            onCompose={compose}
          />

          {list.pageCount > 1 && (
            <div className="flex items-center justify-end gap-2 px-4 py-4 text-sm text-fg-muted">
              <span className="tabular-nums">
                {(list.page - 1) * PAGE_SIZE + 1}–{Math.min(list.page * PAGE_SIZE, list.total)} of {list.total.toLocaleString()}
              </span>
              <Button variant="ghost" size="icon" disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" disabled={list.page >= list.pageCount} onClick={() => list.setPage(list.page + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
