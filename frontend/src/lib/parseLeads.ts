export interface ParsedLeads {
  emails: string[];
  duplicates: number;
  invalid: string[];
}

const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}$/i;

/**
 * Pulls email addresses out of a CSV or plain-text file without assuming a column layout:
 * every cell/token is checked, so "email" columns, "Name <a@b.com>" forms and one-per-line
 * lists all work. Tokens that contain "@" but aren't valid addresses are reported as invalid.
 */
export function parseLeads(text: string): ParsedLeads {
  const seen = new Set<string>();
  const invalid: string[] = [];
  let duplicates = 0;

  const tokens = text.split(/[\s,;|\t]+/);
  for (const raw of tokens) {
    const token = raw.replace(/^["'<(]+|[">)'.]+$/g, "").trim().toLowerCase();
    if (!token.includes("@")) continue;
    if (!EMAIL_RE.test(token)) {
      invalid.push(raw.trim());
      continue;
    }
    if (seen.has(token)) duplicates++;
    else seen.add(token);
  }
  return { emails: [...seen], duplicates, invalid };
}
