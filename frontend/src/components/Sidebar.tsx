import type { EmailStats, ListKind } from "../types/email";
import { Button } from "./ui/Button";

interface SidebarProps {
  active: ListKind;
  stats: EmailStats | null;
  onSelect: (kind: ListKind) => void;
  onCompose: () => void;
}

const tabs: { kind: ListKind; label: string; icon: JSX.Element }[] = [
  {
    kind: "scheduled",
    label: "Scheduled",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    kind: "sent",
    label: "Sent",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7z" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function Sidebar({ active, stats, onSelect, onCompose }: SidebarProps) {
  return (
    <aside className="w-full shrink-0 border-ink-200 bg-white p-4 md:min-h-[calc(100vh-4rem)] md:w-64 md:border-r">
      <Button variant="outline" size="lg" className="w-full" onClick={onCompose} icon={<span className="text-xl leading-none">+</span>}>
        Compose New Email
      </Button>

      <p className="mb-2 mt-6 hidden px-3 text-xs font-semibold uppercase tracking-wider text-ink-400 md:block">Core</p>
      <nav className="mt-3 flex gap-2 md:mt-0 md:flex-col md:gap-1" role="tablist">
        {tabs.map((t) => {
          const selected = t.kind === active;
          return (
            <button
              key={t.kind}
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(t.kind)}
              className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:flex-none ${
                selected ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {t.icon}
              <span className="flex-1 text-left">{t.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? "bg-brand-100" : "bg-ink-100 text-ink-500"}`}>
                {stats ? stats[t.kind] : "–"}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
