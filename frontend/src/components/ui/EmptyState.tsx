import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="relative mb-5">
        <div className="absolute inset-0 scale-150 rounded-full bg-brand-500/10 blur-xl" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface text-brand-600 shadow-card dark:text-brand-400">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
