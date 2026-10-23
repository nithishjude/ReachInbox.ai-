import { Clock3, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RecipientInput } from "../components/compose/RecipientInput";
import { PersonalizePanel } from "../components/compose/PersonalizePanel";
import { RichTextEditor, type RichTextEditorHandle } from "../components/compose/RichTextEditor";
import { SendLaterPopover } from "../components/compose/SendLaterPopover";
import { PageHeader } from "../components/PageHeader";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../hooks/useToast";
import { api } from "../lib/api";
import { formatPillTime } from "../lib/format";
import { isEmptyHtml } from "../lib/html";
import { parseLeadFile } from "../lib/parseLeads";
import type { SendersResponse } from "../types/email";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Errors = Partial<Record<"recipients" | "subject" | "body" | "delay" | "limit", string>>;

interface UploadInfo {
  name: string;
  found: number;
  duplicates: number;
  invalid: number;
}

const label = "w-14 shrink-0 text-[17px] text-fg";
const underlineInput = "min-w-0 flex-1 border-b bg-transparent py-3 text-[17px] outline-none placeholder:text-fg-subtle focus:border-brand-600";
const boxInput = "h-12 w-[88px] rounded-lg border bg-transparent px-3 text-[17px] outline-none placeholder:text-fg-subtle focus:border-brand-600";

export function ComposePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const clockRef = useRef<HTMLButtonElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  // Where a clicked {{variable}} goes: the field the user was last typing in.
  const insertTarget = useRef<"subject" | "body">("body");

  const [meta, setMeta] = useState<SendersResponse | null>(null);
  const [senderId, setSenderId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  // Personalization data from uploaded CSVs: columns and per-email values.
  const [columns, setColumns] = useState<string[]>([]);
  const [leadFields, setLeadFields] = useState<Record<string, Record<string, string>>>({});
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delaySec, setDelaySec] = useState("");
  const [hourlyLimit, setHourlyLimit] = useState("");
  const [sendAt, setSendAt] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [upload, setUpload] = useState<UploadInfo | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .senders()
      .then((m) => {
        setMeta(m);
        setSenderId((id) => id || m.senders[0]?.id || "");
      })
      .catch((err: Error) => toast.error("Couldn't load senders", err.message));
  }, [toast]);

  const clearError = (key: keyof Errors) => setErrors((e) => ({ ...e, [key]: undefined }));
  const selectedSender = meta?.senders.find((s) => s.id === senderId);

  const onUpload = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) return toast.error("File too large", "The limit is 5 MB.");
    const parsed = parseLeadFile(await file.text());
    if (parsed.emails.length === 0) return toast.error("No email addresses found", file.name);
    const merged = [...new Set([...recipients, ...parsed.emails])];
    setRecipients(merged);
    setColumns((c) => [...new Set([...c, ...parsed.columns])]);
    setLeadFields((f) => ({ ...parsed.fields, ...f }));
    setUpload({ name: file.name, found: parsed.emails.length, duplicates: parsed.duplicates, invalid: parsed.invalid.length });
    clearError("recipients");
    toast.success(
      `${parsed.emails.length} email addresses detected`,
      parsed.columns.length ? `${file.name} · personalize with ${parsed.columns.join(", ")}` : file.name,
    );
  };

  const insertVariable = (token: string) => {
    if (insertTarget.current === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? start;
      setSubject(subject.slice(0, start) + token + subject.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      editorRef.current?.insert(token);
    }
  };

  const validate = (): boolean => {
    const next: Errors = {};
    if (recipients.length === 0) next.recipients = "Add recipients or upload a list";
    if (!subject.trim()) next.subject = "Subject is required";
    if (isEmptyHtml(body)) next.body = "Write a message";
    if (delaySec && !(Number(delaySec) >= 0)) next.delay = "Must be 0 or more";
    if (hourlyLimit && !(Number.isInteger(Number(hourlyLimit)) && Number(hourlyLimit) >= 1)) next.limit = "Whole number ≥ 1";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await api.schedule({
        senderId: senderId || undefined,
        subject: subject.trim(),
        body,
        recipients: recipients.map((email) => (leadFields[email] ? { email, fields: leadFields[email] } : email)),
        startAt: (sendAt ?? new Date()).toISOString(),
        delayBetweenEmailsSec: delaySec ? Number(delaySec) : 0,
        hourlyLimit: hourlyLimit ? Number(hourlyLimit) : (meta?.limits.maxEmailsPerHourPerSender ?? 200),
      });
      toast.success(`${res.scheduled} email${res.scheduled === 1 ? "" : "s"} scheduled`, sendAt ? `Starts ${formatPillTime(res.firstSendAt)}` : "Sending now");
      navigate("/");
    } catch (err) {
      toast.error("Couldn't schedule", err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-full pb-12">
      <PageHeader
        title="Compose New Email"
        onBack={() => navigate("/")}
        actions={
          <>
            {sendAt && (
              <span className="hidden items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-sm text-brand-700 sm:inline-flex dark:bg-brand-600/15 dark:text-brand-300">
                {formatPillTime(sendAt.toISOString())}
                <button onClick={() => setSendAt(null)} aria-label="Clear send time" className="rounded-full p-0.5 hover:bg-brand-100 dark:hover:bg-brand-600/30">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
            <button
              onClick={() => fileInput.current?.click()}
              title="Upload lead list"
              aria-label="Upload lead list"
              className={`focus-ring relative rounded-lg p-1.5 hover:bg-subtle ${upload ? "text-brand-600" : "text-fg-subtle"}`}
            >
              <Paperclip className="h-6 w-6" strokeWidth={1.6} />
              {upload && <span className="absolute bottom-0 right-0 rounded-full bg-subtle px-1 text-[10px] leading-4 text-fg">1</span>}
            </button>
            <div>
              <button
                ref={clockRef}
                onClick={() => setPickerOpen((o) => !o)}
                title="Send later"
                aria-label="Send later"
                aria-expanded={pickerOpen}
                className={`focus-ring rounded-lg p-1.5 hover:bg-subtle ${sendAt || pickerOpen ? "text-brand-600" : "text-fg-subtle"}`}
              >
                <Clock3 className="h-6 w-6" strokeWidth={1.6} />
              </button>
              {pickerOpen && (
                <SendLaterPopover
                  anchorRef={clockRef}
                  value={sendAt}
                  onClose={() => setPickerOpen(false)}
                  onDone={(d) => {
                    setSendAt(d);
                    setPickerOpen(false);
                  }}
                />
              )}
            </div>
            <button
              onClick={() => void submit()}
              disabled={submitting}
              className="focus-ring inline-flex h-11 items-center gap-2 rounded-full border border-brand-600 px-7 text-[17px] text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-60 dark:hover:bg-brand-600/10"
            >
              {submitting && <Spinner className="h-4 w-4" />}
              {sendAt ? "Send Later" : "Send"}
            </button>
          </>
        }
      />

      <div className="mx-auto max-w-[1340px] space-y-2 px-5">
        {/* From */}
        <div className="flex items-center gap-3 py-2">
          <span className={label}>From</span>
          <div className="relative">
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              disabled={!meta}
              aria-label="From"
              className="h-12 max-w-full appearance-none rounded-lg bg-subtle pl-3.5 pr-10 text-[17px] outline-none focus:ring-2 focus:ring-brand-600/30"
            >
              {!meta && <option>Loading…</option>}
              {meta?.senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                  {s.real ? " (real delivery)" : ""}
                </option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M5.2 7.2a1 1 0 0 1 1.4 0L10 10.6l3.4-3.4a1 1 0 1 1 1.4 1.4l-4.1 4.1a1 1 0 0 1-1.4 0L5.2 8.6a1 1 0 0 1 0-1.4z" />
            </svg>
          </div>
          {selectedSender?.real && <span className="hidden text-sm text-amber-700 md:inline dark:text-amber-300">Delivers to real inboxes</span>}
        </div>

        {/* To */}
        <div>
          <div className="flex items-center gap-3">
            <span className={label}>To</span>
            <RecipientInput
              emails={recipients}
              onChange={(e) => {
                setRecipients(e);
                clearError("recipients");
              }}
              onUpload={(f) => void onUpload(f)}
              fileInputRef={fileInput}
              invalid={!!errors.recipients}
            />
          </div>
          <p className={`pl-[68px] pt-1.5 text-sm ${errors.recipients ? "text-red-600" : "text-fg-subtle"}`}>
            {errors.recipients ??
              (recipients.length > 0 && (
                <>
                  <span className="font-medium text-brand-700 dark:text-brand-300">{recipients.length} email address{recipients.length === 1 ? "" : "es"}</span>
                  {upload && ` · ${upload.name}: ${upload.found} detected`}
                  {upload && upload.duplicates > 0 && `, ${upload.duplicates} duplicate${upload.duplicates === 1 ? "" : "s"} removed`}
                  {upload && upload.invalid > 0 && `, ${upload.invalid} invalid skipped`}
                </>
              ))}
          </p>
        </div>

        {/* Subject */}
        <div>
          <div className="flex items-center gap-3">
            <span className={label}>Subject</span>
            <input
              ref={subjectRef}
              onFocus={() => (insertTarget.current = "subject")}
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                clearError("subject");
              }}
              placeholder="Subject"
              maxLength={300}
              className={`${underlineInput} ${errors.subject ? "border-red-400" : "border-line"}`}
            />
          </div>
          {errors.subject && <p className="pl-[68px] pt-1.5 text-sm text-red-600">{errors.subject}</p>}
        </div>

        {/* Delay + hourly limit */}
        <div className="flex flex-wrap items-center gap-x-10 gap-y-3 py-4">
          <label className="flex items-center gap-5 text-[17px]">
            Delay between 2 emails
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={delaySec}
              onChange={(e) => {
                setDelaySec(e.target.value);
                clearError("delay");
              }}
              placeholder="00"
              title="Seconds between two emails (default 0)"
              className={`${boxInput} ${errors.delay ? "border-red-400" : "border-line"}`}
            />
          </label>
          <label className="flex items-center gap-2 text-[17px]">
            Hourly Limit
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={hourlyLimit}
              onChange={(e) => {
                setHourlyLimit(e.target.value);
                clearError("limit");
              }}
              placeholder="00"
              title={`Maximum emails per hour (default ${meta?.limits.maxEmailsPerHourPerSender ?? 200})`}
              className={`${boxInput} ${errors.limit ? "border-red-400" : "border-line"}`}
            />
          </label>
          {(errors.delay ?? errors.limit) && <span className="text-sm text-red-600">{errors.delay ?? errors.limit}</span>}
        </div>

        <div className="pb-3">
          <PersonalizePanel columns={columns} recipients={recipients} fields={leadFields} subject={subject} body={body} onInsert={insertVariable} />
        </div>

        <RichTextEditor
          ref={editorRef}
          onFocus={() => (insertTarget.current = "body")}
          value={body}
          onChange={(html) => {
            setBody(html);
            clearError("body");
          }}
          placeholder="Type Your Reply..."
          invalid={!!errors.body}
        />
        {errors.body && <p className="pt-1 text-sm text-red-600">{errors.body}</p>}

      </div>
    </div>
  );
}
