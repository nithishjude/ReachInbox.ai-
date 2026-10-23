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

export interface LeadFile extends ParsedLeads {
  /** Original CSV headers (empty when the file has no header row). */
  columns: string[];
  /** Per-email column values, for {{variables}}. */
  fields: Record<string, Record<string, string>>;
}

/** Minimal RFC 4180-style splitter: handles quoted cells with delimiters and "" escapes. */
function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const EMAIL_HEADER = /^(e-?mail|email[\s_-]*address|work[\s_-]*email)$/i;

/**
 * Parses an uploaded lead list. A CSV with a header row containing an email column keeps every
 * other column (name, company, ...) for personalization. Anything else falls back to scanning
 * for addresses with {@link parseLeads}.
 */
export function parseLeadFile(text: string): LeadFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const first = lines[0] ?? "";
  const delimiter = [",", ";", "\t"].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ",");
  const header = splitRow(first, delimiter);
  const emailCol = header.findIndex((h) => EMAIL_HEADER.test(h));

  if (emailCol === -1 || first.includes("@")) return { ...parseLeads(text), columns: [], fields: {} };

  const fields: Record<string, Record<string, string>> = {};
  const emails: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const line of lines.slice(1)) {
    const cells = splitRow(line, delimiter);
    const email = (cells[emailCol] ?? "").replace(/^<|>$/g, "").toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      invalid.push(cells[emailCol]);
      continue;
    }
    if (fields[email]) {
      duplicates++;
      continue;
    }
    fields[email] = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]).filter(([h], i) => h && i !== emailCol));
    emails.push(email);
  }
  return { emails, duplicates, invalid, columns: header.filter((h, i) => h && i !== emailCol), fields };
}
