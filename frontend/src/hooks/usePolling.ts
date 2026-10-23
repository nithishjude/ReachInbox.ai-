import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 5000;

/**
 * Fetch now and every 5 s while mounted; refetch from scratch when `key` changes.
 * Out-of-order responses are ignored, and background refreshes keep the previous data visible.
 */
export function usePolling<T>(fetcher: () => Promise<T>, key: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (background: boolean) => {
    const id = ++requestId.current;
    if (!background) setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (id !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    const t = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load, key, enabled]);

  return { data, loading, error, refresh: () => void load(true) };
}
