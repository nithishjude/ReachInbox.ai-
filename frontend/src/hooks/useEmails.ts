import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { EmailItem, ListKind } from "../types/email";

const POLL_MS = 5000;
const PAGE_SIZE = 50;

interface UseEmailsResult {
  items: EmailItem[];
  total: number;
  page: number;
  pageCount: number;
  setPage: (p: number) => void;
  loading: boolean; // first load / filter change (shows skeleton)
  refreshing: boolean; // background refresh (keeps rows visible)
  error: string | null;
  refresh: () => void;
}

/**
 * Loads one tab's emails and keeps them fresh by polling, so emails visibly move from
 * Scheduled to Sent while the worker runs. Stale responses are ignored.
 */
export function useEmails(kind: ListKind, search: string, refreshKey: number): UseEmailsResult {
  const [items, setItems] = useState<EmailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (background: boolean) => {
      const id = ++requestId.current;
      background ? setRefreshing(true) : setLoading(true);
      try {
        const res = await api.listEmails(kind, { search, page, pageSize: PAGE_SIZE });
        if (id !== requestId.current) return;
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err.message : "Failed to load emails");
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [kind, search, page],
  );

  // Reset to page 1 when switching tab or search.
  useEffect(() => setPage(1), [kind, search]);

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load, refreshKey]);

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    setPage,
    loading,
    refreshing,
    error,
    refresh: () => void load(true),
  };
}
