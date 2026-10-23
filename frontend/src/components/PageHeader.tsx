import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** "← Title ............ actions" bar used by the compose and email pages. */
export function PageHeader({ title, onBack, actions }: { title: ReactNode; onBack: () => void; actions?: ReactNode }) {
  return (
    <header className="flex items-center gap-4 px-5 py-5">
      <button onClick={onBack} aria-label="Back" className="focus-ring rounded-lg p-1 text-fg hover:bg-subtle">
        <ArrowLeft className="h-6 w-6" strokeWidth={1.75} />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-[28px] leading-tight">{title}</h1>
      {actions && <div className="relative flex shrink-0 items-center gap-3">{actions}</div>}
    </header>
  );
}
