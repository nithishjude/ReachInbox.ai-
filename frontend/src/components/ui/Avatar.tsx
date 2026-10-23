import { useState } from "react";
import { initials } from "../../lib/format";

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (src && !broken) {
    return (
      <img
        src={src}
        alt={name}
        style={style}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover ring-2 ring-white"
      />
    );
  }
  return (
    <span style={style} className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
      {initials(name)}
    </span>
  );
}
