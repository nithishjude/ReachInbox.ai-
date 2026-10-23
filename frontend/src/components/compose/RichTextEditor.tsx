import {
  AlignCenter,
  AlignLeft,
  Bold,
  ChevronsUpDown,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  UnfoldVertical,
  type LucideIcon,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/*
 * Lightweight rich-text editor (contentEditable + execCommand). execCommand is deprecated but still
 * supported by every browser and is plenty for formatting an outreach email without a 100 kB editor.
 */

const exec = (command: string, value?: string) => document.execCommand(command, false, value);

const sizes = [
  { label: "Small", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "5" },
  { label: "Huge", value: "6" },
];
const alignments = ["justifyLeft", "justifyCenter", "justifyRight"] as const;

function ToolButton({ icon: Icon, label, onClick, active }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // mousedown + preventDefault keeps the text selection inside the editor
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`rounded-md p-1.5 transition-colors hover:bg-subtle ${active ? "bg-subtle text-fg" : "text-fg-muted"}`}
    >
      <Icon className="h-[22px] w-[22px]" strokeWidth={1.6} />
    </button>
  );
}

const Divider = () => <span className="mx-1.5 h-7 w-px bg-line" />;

export interface RichTextEditorHandle {
  /** Insert plain text at the last caret position (used for {{variables}}). */
  insert: (text: string) => void;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  invalid?: boolean;
  onFocus?: () => void;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor({ value, onChange, placeholder, invalid, onFocus }, handle) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [alignIndex, setAlignIndex] = useState(0);
  const [spacious, setSpacious] = useState(false);

  // Only push external value changes (e.g. form reset) into the DOM, never while typing (keeps caret).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [value]);

  // Remember the caret while the user clicks elsewhere (e.g. a variable chip).
  useEffect(() => {
    const save = () => {
      const sel = document.getSelection();
      if (sel?.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", save);
    return () => document.removeEventListener("selectionchange", save);
  }, []);

  useImperativeHandle(handle, () => ({
    insert(text: string) {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const sel = document.getSelection();
      if (sel && savedRange.current) {
        sel.removeAllRanges();
        sel.addRange(savedRange.current);
      } else if (sel) {
        sel.selectAllChildren(el);
        sel.collapseToEnd();
      }
      exec("insertText", text);
      onChange(el.innerHTML);
    },
  }));

  const run = (command: string, arg?: string) => {
    ref.current?.focus();
    exec(command, arg);
    onChange(ref.current?.innerHTML ?? "");
  };

  return (
    <div className={`rounded-xl bg-subtle/60 p-5 ring-1 ${invalid ? "ring-red-400" : "ring-transparent"}`}>
      <div className="relative mb-4 flex flex-wrap items-center gap-0.5 rounded-full bg-surface px-4 py-1.5 shadow-sm">
        <ToolButton icon={Undo2} label="Undo" onClick={() => run("undo")} />
        <ToolButton icon={Redo2} label="Redo" onClick={() => run("redo")} />
        <Divider />
        <div className="relative">
          <button
            type="button"
            title="Text size"
            onMouseDown={(e) => {
              e.preventDefault();
              setSizeOpen((o) => !o);
            }}
            className="flex items-center rounded-md p-1.5 text-fg-muted hover:bg-subtle"
          >
            <Type className="h-[22px] w-[22px]" strokeWidth={1.6} />
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </button>
          {sizeOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-32 rounded-lg border border-line bg-surface p-1 shadow-pop">
              {sizes.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    run("fontSize", s.value);
                    setSizeOpen(false);
                  }}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-subtle"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <Divider />
        <ToolButton icon={Bold} label="Bold" onClick={() => run("bold")} />
        <ToolButton icon={Italic} label="Italic" onClick={() => run("italic")} />
        <ToolButton icon={Underline} label="Underline" onClick={() => run("underline")} />
        <Divider />
        <ToolButton
          icon={AlignCenter}
          label="Align (left / center / right)"
          onClick={() => {
            const next = (alignIndex + 1) % alignments.length;
            setAlignIndex(next);
            run(alignments[next]);
          }}
        />
        <ToolButton icon={UnfoldVertical} label="Line spacing" active={spacious} onClick={() => setSpacious((s) => !s)} />
        <Divider />
        <ToolButton icon={ListOrdered} label="Numbered list" onClick={() => run("insertOrderedList")} />
        <ToolButton icon={List} label="Bulleted list" onClick={() => run("insertUnorderedList")} />
        <ToolButton icon={IndentIncrease} label="Indent" onClick={() => run("indent")} />
        <ToolButton icon={IndentDecrease} label="Outdent" onClick={() => run("outdent")} />
        <ToolButton icon={Quote} label="Quote" onClick={() => run("formatBlock", "blockquote")} />
        <ToolButton
          icon={AlignLeft}
          label="Reset alignment"
          onClick={() => {
            setAlignIndex(0);
            run("justifyLeft");
          }}
        />
        <Divider />
        <ToolButton icon={Strikethrough} label="Strikethrough" onClick={() => run("strikeThrough")} />
      </div>

      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Email body"
        data-placeholder={placeholder}
        onInput={() => onChange(ref.current?.innerHTML ?? "")}
        onFocus={onFocus}
        className={`email-body editor min-h-[360px] px-1 text-[17px] outline-none ${spacious ? "leading-loose" : "leading-relaxed"}`}
      />
    </div>
  );
});
