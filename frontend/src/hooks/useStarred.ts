import { useCallback, useState } from "react";

const KEY = "starred-emails";

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Starred emails are a personal view preference, so they live in the browser, not the DB. */
export function useStarred(): { isStarred: (id: string) => boolean; toggle: (id: string) => void } {
  const [starred, setStarred] = useState<Set<string>>(load);

  const toggle = useCallback((id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable: star just won't persist */
      }
      return next;
    });
  }, []);

  return { isStarred: (id) => starred.has(id), toggle };
}
