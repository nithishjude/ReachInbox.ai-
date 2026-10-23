import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const read = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable: theme just won't persist */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
