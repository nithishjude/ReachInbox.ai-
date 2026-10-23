import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toLocalInputValue } from "../../lib/format";

const tomorrowAt = (h?: number) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (h !== undefined) d.setHours(h, 0, 0, 0);
  return d;
};

// Presets from the Figma.
const presets: { label: string; at: () => Date }[] = [
  { label: "Tomorrow", at: () => tomorrowAt() },
  { label: "Tomorrow, 10:00 AM", at: () => tomorrowAt(10) },
  { label: "Tomorrow, 11:00 AM", at: () => tomorrowAt(11) },
  { label: "Tomorrow, 3:00 PM", at: () => tomorrowAt(15) },
];

interface Props {
  /** The button that opens the popover; clicks on it are not "outside" clicks. */
  anchorRef: React.RefObject<HTMLElement>;
  value: Date | null;
  onDone: (date: Date) => void;
  onClose: () => void;
}

/** "Send Later" card: a date-time picker plus quick presets, applied with Done. */
export function SendLaterPopover({ anchorRef, value, onDone, onClose }: Props) {
  const [draft, setDraft] = useState(value ? toLocalInputValue(value) : "");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchorRef.current?.contains(target)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose, anchorRef]);

  const done = () => {
    const d = new Date(draft);
    if (!draft || Number.isNaN(d.getTime())) return setError("Pick a date & time");
    if (d.getTime() < Date.now() - 60_000) return setError("That time is in the past");
    onDone(d);
  };

  return (
    <div ref={ref} role="dialog" aria-label="Send later" className="animate-scale-in absolute right-0 top-full z-30 mt-3 w-[400px] max-w-[calc(100vw-2rem)] origin-top-right rounded-xl border border-line bg-surface p-5 shadow-pop">
      <h2 className="text-lg font-medium">Send Later</h2>

      <div className={`relative mt-5 border-b focus-within:border-brand-600 ${error ? "border-red-400" : "border-line"}`}>
        {/* Native pickers can't show a placeholder, so show a text field until it's used (Figma: "Pick date & time"). */}
        <input
          type={focused || draft ? "datetime-local" : "text"}
          value={draft}
          min={toLocalInputValue(new Date())}
          placeholder="Pick date & time"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          aria-label="Pick date & time"
          className="w-full bg-transparent pb-2 pr-8 text-[16px] text-fg outline-none placeholder:text-fg-muted [&::-webkit-calendar-picker-indicator]:opacity-0"
        />
        <CalendarDays className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-fg-muted" strokeWidth={1.5} />
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      <ul className="mt-4">
        {presets.map((p) => {
          const at = toLocalInputValue(p.at());
          return (
            <li key={p.label}>
              <button
                type="button"
                onClick={() => {
                  setDraft(at);
                  setError(null);
                }}
                className={`-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-2.5 text-left text-[16px] transition-colors hover:bg-subtle ${draft === at ? "font-medium text-brand-700" : "text-fg"}`}
              >
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-8 flex items-center justify-end gap-6">
        <button type="button" onClick={onClose} className="text-[16px] text-fg hover:text-fg-muted">
          Cancel
        </button>
        <button type="button" onClick={done} className="h-10 rounded-full border border-brand-600 px-7 text-[16px] text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-600/10">
          Done
        </button>
      </div>
    </div>
  );
}
