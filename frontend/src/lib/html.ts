import DOMPurify from "dompurify";

/** Bodies from the rich-text editor are HTML; older/API bodies may be plain text. */
export const isHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s);

/** One-line preview for list rows. */
export function toPlainText(body: string): string {
  if (!isHtml(body)) return body;
  // Separate block elements so "<p>a</p><li>b</li>" reads "a b", not "ab".
  const spaced = body.replace(/<\/(p|div|li|h\d|blockquote)>|<br\s*\/?>/gi, (m) => `${m} `);
  const doc = new DOMParser().parseFromString(spaced, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Safe HTML for rendering a body inside the app (scripts, handlers, iframes stripped). */
export const sanitize = (html: string) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

export const isEmptyHtml = (html: string) => toPlainText(html).length === 0;
