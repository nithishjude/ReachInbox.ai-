/**
 * Personalization: `{{first_name}}`, `{{ company }}`, `{{name | there}}` (fallback when missing/empty).
 * Keys are matched case-insensitively against the lead's CSV columns (normalised to snake_case).
 */
const VAR = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export type LeadVars = Record<string, string>;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Normalise a CSV header to a variable key: "First Name" -> "first_name". */
export const toVarKey = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Variables available for one lead: its columns, plus `email` and a derived `first_name`. */
export function leadVars(email: string, fields: Record<string, string> = {}): LeadVars {
  const vars: LeadVars = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = toVarKey(k);
    if (key) vars[key] = String(v ?? "").trim();
  }
  vars.email = email;
  if (!vars.first_name && vars.name) vars.first_name = vars.name.split(/\s+/)[0];
  return vars;
}

/** Render a template. `html: true` escapes values so lead data can't inject markup into HTML bodies. */
export function renderTemplate(template: string, vars: LeadVars, { html = false } = {}): string {
  return template.replace(VAR, (_m, key: string, fallback?: string) => {
    const value = vars[key.toLowerCase()]?.trim() || (fallback ?? "");
    return html ? escapeHtml(value) : value;
  });
}

export const usesVariables = (template: string) => new RegExp(VAR.source).test(template);
