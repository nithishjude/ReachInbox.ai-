import { Activity, ChevronDown, LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { Avatar } from "./ui/Avatar";

const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors";

/** Sidebar user card (avatar, name, email) with a dropdown for theme, queue monitor and logout. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="focus-ring flex w-full items-center gap-3 rounded-2xl bg-subtle px-3.5 py-3 text-left transition-colors hover:bg-line/60"
      >
        <Avatar name={user.name} src={user.avatarUrl} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-tight">{user.name}</span>
          <span className="block truncate text-xs text-fg-muted">{user.email}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div role="menu" className="animate-scale-in absolute left-0 right-0 z-30 mt-2 origin-top rounded-xl border border-line bg-surface p-1 shadow-pop">
          <button role="menuitem" onClick={toggle} className={`${item} text-fg hover:bg-subtle`}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          {user.isAdmin && (
            <a role="menuitem" href="/admin/queues" target="_blank" rel="noreferrer" className={`${item} text-fg hover:bg-subtle`}>
              <Activity className="h-4 w-4" />
              Queue monitor
            </a>
          )}
          <div className="my-1 h-px bg-line" />
          <button role="menuitem" onClick={() => void logout()} className={`${item} text-red-600 hover:bg-red-500/10 dark:text-red-400`}>
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
