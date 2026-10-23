import { useState } from "react";
import { initials } from "../../lib/format";

// Deterministic pastel per name, so the same lead always gets the same colour.
const palette = [
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
];
const colorFor = (s: string) => palette[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % palette.length];

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (src && !broken) {
    return (
      <img
        src={src}
        alt={name}
        style={style}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover ring-1 ring-line"
      />
    );
  }
  return (
    <span
      style={style}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${colorFor(name)}`}
    >
      {initials(name)}
    </span>
  );
}
