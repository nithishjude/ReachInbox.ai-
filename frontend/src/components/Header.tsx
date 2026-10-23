import { useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { Avatar } from "./ui/Avatar";
import { Logo } from "./Logo";

export function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!user) return null;
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-ink-200 bg-white px-4 sm:px-6">
      <Logo />
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-3 rounded-full py-1 pl-1 pr-3 hover:bg-ink-100"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar name={user.name} src={user.avatarUrl} />
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-semibold leading-tight">{user.name}</span>
            <span className="block text-xs leading-tight text-ink-500">{user.email}</span>
          </span>
          <svg viewBox="0 0 20 20" className={`h-4 w-4 text-ink-500 transition-transform ${open ? "rotate-180" : ""}`} fill="currentColor">
            <path d="M5.2 7.2a1 1 0 0 1 1.4 0L10 10.6l3.4-3.4a1 1 0 1 1 1.4 1.4l-4.1 4.1a1 1 0 0 1-1.4 0L5.2 8.6a1 1 0 0 1 0-1.4z" />
          </svg>
        </button>
        {open && (
          <div role="menu" className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="border-b border-ink-100 px-4 py-3 sm:hidden">
              <p className="text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-ink-500">{user.email}</p>
            </div>
            <a role="menuitem" href="/admin/queues" target="_blank" rel="noreferrer" className="block px-4 py-2.5 text-sm text-ink-700 hover:bg-ink-50">
              Queue dashboard ↗
            </a>
            <button role="menuitem" onClick={() => void logout()} className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50">
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
