import { AlertTriangle, Braces, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { isHtml, sanitize } from "../../lib/html";
import { availableKeys, leadVars, renderTemplate, usedVariables } from "../../lib/template";

interface PersonalizePanelProps {
  columns: string[];
  recipients: string[];
  fields: Record<string, Record<string, string>>;
  subject: string;
  body: string;
  onInsert: (token: string) => void;
}

const PREVIEW_LIMIT = 50;

/**
 * Variable chips from the uploaded CSV columns, a warning for unknown variables, and a live preview
 * of the exact subject/body a chosen recipient will receive.
 */
export function PersonalizePanel({ columns, recipients, fields, subject, body, onInsert }: PersonalizePanelProps) {
  const keys = useMemo(() => availableKeys(columns), [columns]);
  const [previewEmail, setPreviewEmail] = useState<string>("");
  const [showPreview, setShowPreview] = useState(true);

  const unknown = useMemo(
    () => usedVariables(`${subject} ${body}`).filter((v) => !keys.includes(v.key) && !v.hasFallback).map((v) => v.key),
    [subject, body, keys],
  );

  const target = recipients.includes(previewEmail) ? previewEmail : recipients[0];
  const vars = target ? leadVars(target, fields[target]) : null;
  const personalised = usedVariables(`${subject} ${body}`).length > 0;

  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1.5 text-sm font-medium">
          <Braces className="h-4 w-4 text-brand-600" />
          Personalize
        </span>
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onMouseDown={(e) => e.preventDefault()} // keep the caret where it is
            onClick={() => onInsert(`{{${k}}}`)}
            title={`Insert {{${k}}}`}
            className="rounded-md border border-brand-600/40 bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-700 hover:border-brand-600 dark:bg-brand-600/15 dark:text-brand-300"
          >
            {`{{${k}}}`}
          </button>
        ))}
        <span className="text-xs text-fg-subtle">
          {columns.length ? "from your CSV columns · fallback: {{first_name|there}}" : "Upload a CSV with a header row (email, name, company…) for more variables"}
        </span>
      </div>

      {unknown.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {unknown.map((k) => `{{${k}}}`).join(", ")} {unknown.length === 1 ? "isn't a column" : "aren't columns"} in your list and will be blank. Add a fallback like{" "}
            <code>{`{{${unknown[0]}|there}}`}</code>.
          </span>
        </p>
      )}

      {personalised && vars && (
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <button type="button" onClick={() => setShowPreview((v) => !v)} className="flex items-center gap-1.5 font-medium hover:text-fg">
              <Eye className="h-3.5 w-3.5" />
              {showPreview ? "Hide preview" : "Show preview"}
            </button>
            {showPreview && (
              <>
                <span>for</span>
                <select
                  value={target}
                  onChange={(e) => setPreviewEmail(e.target.value)}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none"
                  aria-label="Preview recipient"
                >
                  {recipients.slice(0, PREVIEW_LIMIT).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {showPreview && (
            <div className="mt-2 rounded-lg bg-subtle/60 p-4">
              <p className="text-sm">
                <span className="text-fg-muted">Subject: </span>
                <span className="font-medium">{renderTemplate(subject, vars) || "(no subject)"}</span>
              </p>
              {isHtml(body) ? (
                <div className="email-body mt-2 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitize(renderTemplate(body, vars, { html: true })) }} />
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-sm">{renderTemplate(body, vars)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
