import { Clock3, Send, type LucideIcon } from "lucide-react";
import type { EmailStats, ListKind } from "../types/email";
import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";

interface SidebarProps {
  active: ListKind;
  stats: EmailStats | null;
  onSelect: (kind: ListKind) => void;
  onCompose: () => void;
}

const tabs: { kind: ListKind; label: string; icon: LucideIcon }[] = [
  { kind: "scheduled", label: "Scheduled", icon: Clock3 },
  { kind: "sent", label: "Sent", icon: Send },
];

export function Sidebar({ active, stats, onSelect, onCompose }: SidebarProps) {
  return (
    <div className="flex h-full flex-col gap-3 px-3 py-6">
      <div className="px-3 pb-2">
        <Logo />
      </div>

      <UserMenu />

      <button
        onClick={onCompose}
        className="focus-ring h-11 w-full rounded-full border border-brand-600 text-[17px] font-medium text-brand-600 transition-colors hover:bg-brand-50 dark:hover:bg-brand-600/10"
      >
        Compose
      </button>

      <nav className="mt-4" role="tablist" aria-label="Mailboxes">
        <p className="px-5 pb-2 text-sm uppercase text-fg-subtle">Core</p>
        {tabs.map(({ kind, label, icon: Icon }) => {
          const selected = kind === active;
          return (
            <button
              key={kind}
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(kind)}
              className={`focus-ring mb-1 flex w-full items-center gap-3.5 rounded-xl px-5 py-3 text-[17px] transition-colors ${
                selected ? "bg-brand-50 font-semibold text-fg dark:bg-brand-600/15" : "text-fg hover:bg-subtle"
              }`}
            >
              <Icon className="h-5 w-5 text-fg-muted" strokeWidth={1.75} />
              <span className="flex-1 text-left">{label}</span>
              <span className="text-sm font-normal tabular-nums text-fg-muted">{stats ? stats[kind].toLocaleString() : ""}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
