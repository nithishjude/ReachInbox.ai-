/**
 * Same template rules as the backend (backend/src/lib/template.ts), used for the live preview:
 * `{{first_name}}`, `{{ company }}`, `{{name | there}}` (fallback when missing/empty).
 */
const VAR = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export type LeadVars = Record<string, string>;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const toVarKey = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

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

export function renderTemplate(template: string, vars: LeadVars, { html = false } = {}): string {
  return template.replace(VAR, (_m, key: string, fallback?: string) => {
    const value = vars[key.toLowerCase()]?.trim() || (fallback ?? "");
    return html ? escapeHtml(value) : value;
  });
}

/** Variables used in a template, with whether each one has a fallback. */
export function usedVariables(template: string): { key: string; hasFallback: boolean }[] {
  const out = new Map<string, boolean>();
  for (const m of template.matchAll(VAR)) out.set(m[1].toLowerCase(), (out.get(m[1].toLowerCase()) ?? false) || m[2] !== undefined);
  return [...out].map(([key, hasFallback]) => ({ key, hasFallback }));
}

/** Keys every lead has: its CSV columns plus email (and first_name when a name column exists). */
export function availableKeys(columns: string[]): string[] {
  const keys = new Set(columns.map(toVarKey).filter(Boolean));
  if (keys.has("name")) keys.add("first_name");
  keys.add("email");
  return [...keys];
}
