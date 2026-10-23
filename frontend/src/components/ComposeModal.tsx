import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useToast } from "../hooks/useToast";
import { api } from "../lib/api";
import { formatDateTime, toLocalInputValue } from "../lib/format";
import { parseLeads } from "../lib/parseLeads";
import type { SendersResponse } from "../types/email";
import { Button } from "./ui/Button";
import { Field, Input, Select, Textarea } from "./ui/Field";
import { Modal } from "./ui/Modal";

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

interface FormState {
  senderId: string;
  subject: string;
  body: string;
  pasted: string;
  startAt: string;
  delaySec: string;
  hourlyLimit: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const presets: { label: string; at: () => Date }[] = [
  { label: "Now", at: () => new Date() },
  { label: "In 2 min", at: () => new Date(Date.now() + 2 * 60_000) },
  { label: "In 1 hour", at: () => new Date(Date.now() + 3_600_000) },
  {
    label: "Tomorrow 9 AM",
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

const initialForm = (): FormState => ({
  senderId: "",
  subject: "",
  body: "",
  pasted: "",
  startAt: toLocalInputValue(new Date(Date.now() + 60_000)),
  delaySec: "2",
  hourlyLimit: "",
});

export function ComposeModal({ open, onClose, onScheduled }: ComposeModalProps) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(initialForm);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [meta, setMeta] = useState<SendersResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | "leads", string>>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  // Reset every time the modal opens, and load senders + server-side limits for defaults.
  useEffect(() => {
    if (!open) return;
    setForm(initialForm());
    setFile(null);
    setErrors({});
    api
      .senders()
      .then((m) => {
        setMeta(m);
        setForm((f) => ({
          ...f,
          senderId: f.senderId || m.senders[0]?.id || "",
          hourlyLimit: f.hourlyLimit || String(m.limits.maxEmailsPerHourPerSender),
        }));
      })
      .catch((err: Error) => toast.error(err.message));
  }, [open, toast]);

  const leads = useMemo(() => parseLeads(`${file?.text ?? ""}\n${form.pasted}`), [file, form.pasted]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      toast.error("File is larger than 5 MB");
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text });
    setErrors((e) => ({ ...e, leads: undefined }));
    const found = parseLeads(text).emails.length;
    if (found === 0) toast.error(`No email addresses found in ${f.name}`);
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (leads.emails.length === 0) next.leads = "Upload a CSV/text file or paste at least one email address";
    if (!form.subject.trim()) next.subject = "Subject is required";
    if (!form.body.trim()) next.body = "Body is required";
    if (!form.startAt || Number.isNaN(new Date(form.startAt).getTime())) next.startAt = "Pick a start time";
    if (!(Number(form.delaySec) >= 0)) next.delaySec = "Must be 0 or more";
    if (!(Number.isInteger(Number(form.hourlyLimit)) && Number(form.hourlyLimit) >= 1)) next.hourlyLimit = "Must be a whole number ≥ 1";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await api.schedule({
        senderId: form.senderId || undefined,
        subject: form.subject.trim(),
        body: form.body,
        recipients: leads.emails,
        startAt: new Date(form.startAt).toISOString(),
        delayBetweenEmailsSec: Number(form.delaySec),
        hourlyLimit: Number(form.hourlyLimit),
      });
      toast.success(`Scheduled ${res.scheduled} email${res.scheduled === 1 ? "" : "s"} from ${res.sender.email}`);
      onScheduled();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule");
    } finally {
      setSubmitting(false);
    }
  };

  // Planned window ignoring throttling, to help the user pick delay/limit.
  const plan = useMemo(() => {
    const n = leads.emails.length;
    const start = new Date(form.startAt);
    if (!n || Number.isNaN(start.getTime())) return null;
    const delayMs = Math.max(0, Number(form.delaySec) || 0) * 1000;
    const limit = Number(form.hourlyLimit) || 0;
    return { n, last: new Date(start.getTime() + (n - 1) * delayMs), hours: limit ? Math.ceil(n / limit) : null };
  }, [leads.emails.length, form.startAt, form.delaySec, form.hourlyLimit]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compose New Email"
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="compose-form" loading={submitting}>
            Schedule
          </Button>
        </>
      }
    >
      <form id="compose-form" onSubmit={submit} className="space-y-5" noValidate>
        <Field label="From">
          <Select value={form.senderId} onChange={(e) => set("senderId", e.target.value)} disabled={!meta}>
            {!meta && <option>Loading senders…</option>}
            {meta?.senders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} &lt;{s.email}&gt; — {s.usage.used}/{s.usage.limit} this hour
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-700">To (leads)</span>
          <div className={`rounded-lg border border-dashed p-4 ${errors.leads ? "border-red-400" : "border-ink-200"}`}>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                Upload CSV / TXT
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {file ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-ink-100 px-3 py-1 text-xs">
                  {file.name}
                  <button type="button" onClick={() => setFile(null)} className="text-ink-500 hover:text-ink-900" aria-label="Remove file">
                    ✕
                  </button>
                </span>
              ) : (
                <span className="text-xs text-ink-500">Any column layout works — every cell is scanned for addresses.</span>
              )}
            </div>
            <Textarea
              className="mt-3"
              rows={2}
              placeholder="…or paste addresses, separated by commas or new lines"
              value={form.pasted}
              onChange={(e) => set("pasted", e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-700">
                {leads.emails.length} email{leads.emails.length === 1 ? "" : "s"} detected
              </span>
              {leads.duplicates > 0 && <span className="rounded-full bg-ink-100 px-2.5 py-1 text-ink-700">{leads.duplicates} duplicate(s) removed</span>}
              {leads.invalid.length > 0 && (
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700" title={leads.invalid.slice(0, 20).join("\n")}>
                  {leads.invalid.length} invalid skipped
                </span>
              )}
            </div>
          </div>
          {errors.leads && <span className="mt-1 block text-xs text-red-600">{errors.leads}</span>}
        </div>

        <Field label="Subject" error={errors.subject}>
          <Input value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="Quick question about your outreach" maxLength={300} />
        </Field>

        <Field label="Body" error={errors.body}>
          <Textarea rows={7} value={form.body} onChange={(e) => set("body", e.target.value)} placeholder="Hi there, …" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start time" error={errors.startAt}>
            <Input type="datetime-local" value={form.startAt} onChange={(e) => set("startAt", e.target.value)} />
          </Field>
          <Field label="Delay between emails (sec)" error={errors.delaySec} hint={meta ? `Server min gap: ${meta.limits.minDelayBetweenSendsMs / 1000}s/sender` : undefined}>
            <Input type="number" min={0} step="any" value={form.delaySec} onChange={(e) => set("delaySec", e.target.value)} />
          </Field>
          <Field label="Hourly limit" error={errors.hourlyLimit} hint={meta ? `Sender cap: ${meta.limits.maxEmailsPerHourPerSender}/hour` : undefined}>
            <Input type="number" min={1} step={1} value={form.hourlyLimit} onChange={(e) => set("hourlyLimit", e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => set("startAt", toLocalInputValue(p.at()))}
              className="rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-700 hover:border-brand-500 hover:text-brand-700"
            >
              {p.label}
            </button>
          ))}
        </div>

        {plan && (
          <p className="rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700">
            {plan.n} email{plan.n === 1 ? "" : "s"} from <b>{formatDateTime(new Date(form.startAt).toISOString())}</b>
            {plan.n > 1 && (
              <>
                {" "}to <b>{formatDateTime(plan.last.toISOString())}</b>
              </>
            )}
            {plan.hours && plan.hours > 1 && <> · the hourly limit spreads them over at least {plan.hours} hours</>}.
          </p>
        )}
      </form>
    </Modal>
  );
}
