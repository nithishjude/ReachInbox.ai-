import { Check, Filter } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EmailStatus, ListKind } from "../types/email";

export type StatusFilter = "all" | EmailStatus;

const options: Record<ListKind, { value: StatusFilter; label: string }[]> = {
  scheduled: [
    { value: "all", label: "All scheduled" },
    { value: "scheduled", label: "Waiting for send time" },
    { value: "rate_limited", label: "Rate limited" },
  ],
  sent: [
    { value: "all", label: "All" },
    { value: "sent", label: "Sent" },
    { value: "failed", label: "Failed" },
  ],
};

/** The funnel icon next to search: narrows the current tab by status. */
export function FilterMenu({ kind, value, onChange }: { kind: ListKind; value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const active = value !== "all";
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Filter by status"
        aria-haspopup="menu"
        className={`focus-ring relative rounded-lg p-2 transition-colors hover:bg-subtle ${active ? "text-brand-600" : "text-fg-muted"}`}
      >
        <Filter className="h-5 w-5" strokeWidth={1.5} />
        {active && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-600" />}
      </button>
      {open && (
        <div role="menu" className="animate-scale-in absolute right-0 z-30 mt-2 w-56 origin-top-right rounded-xl border border-line bg-surface p-1 shadow-pop">
          {options[kind].map((o) => (
            <button
              key={o.value}
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle"
            >
              {o.label}
              {o.value === value && <Check className="h-4 w-4 text-brand-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
