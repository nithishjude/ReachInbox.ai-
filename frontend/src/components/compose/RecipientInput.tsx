import { Upload, X } from "lucide-react";
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { parseLeads } from "../../lib/parseLeads";

const COLLAPSED_CHIPS = 3;

interface RecipientInputProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  /** Called with the result of a parsed upload so the page can report duplicates/invalid rows. */
  onUpload: (file: File) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  invalid?: boolean;
}

/** "To" row from the Figma: green address chips, a "+N" overflow chip and an "Upload List" action. */
export function RecipientInput({ emails, onChange, onUpload, fileInputRef, invalid }: RecipientInputProps) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (text: string) => {
    const parsed = parseLeads(text).emails;
    if (parsed.length) onChange([...new Set([...emails, ...parsed])]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (["Enter", ",", " ", "Tab"].includes(e.key) && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && emails.length) {
      onChange(emails.slice(0, -1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    add(e.clipboardData.getData("text"));
  };

  const visible = expanded ? emails : emails.slice(0, COLLAPSED_CHIPS);
  const hidden = emails.length - visible.length;

  return (
    <div
      className={`flex min-h-[52px] flex-1 flex-wrap items-center gap-1.5 border-b py-2 ${invalid ? "border-red-400" : "border-line"}`}
      onClick={() => input.current?.focus()}
    >
      {visible.map((email) => (
        <span
          key={email}
          className="inline-flex items-center gap-1 rounded-full border border-brand-600 bg-brand-50 py-0.5 pl-3 pr-1.5 text-[15px] text-fg dark:bg-brand-600/15"
        >
          {email}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(emails.filter((x) => x !== email));
            }}
            className="rounded-full p-0.5 text-fg-subtle hover:bg-brand-100 hover:text-fg dark:hover:bg-brand-600/30"
            aria-label={`Remove ${email}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="rounded-full border border-brand-600 bg-brand-50 px-3 py-0.5 text-[15px] font-medium dark:bg-brand-600/15"
        >
          +{hidden}
        </button>
      )}
      {expanded && emails.length > COLLAPSED_CHIPS && (
        <button type="button" onClick={() => setExpanded(false)} className="px-2 text-sm text-fg-muted hover:text-fg">
          Show less
        </button>
      )}
      <input
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={emails.length ? "" : "recipient@example.com"}
        size={1}
        aria-label="Recipients"
        className="w-24 min-w-[6rem] flex-1 bg-transparent px-1 text-[17px] outline-none placeholder:text-fg-subtle"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          fileInputRef.current?.click();
        }}
        className="ml-auto flex shrink-0 items-center gap-2 px-1 text-[17px] text-brand-600 hover:text-brand-700"
      >
        <Upload className="h-5 w-5" strokeWidth={1.75} />
        Upload List
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
