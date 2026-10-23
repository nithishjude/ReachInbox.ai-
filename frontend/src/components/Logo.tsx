/** Wordmark in the pixel style of the Figma logo. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`select-none font-pixel text-[30px] font-bold leading-none tracking-tight text-fg ${className}`}>
      Reach<span className="text-brand-600">Inbox</span>
    </span>
  );
}
