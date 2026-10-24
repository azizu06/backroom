/** Keep public redaction tokens intact; never unmask, escape or rewrite their text. */
export function handoffText(text: string): { text: string; masked: boolean }[] {
  const tokens = /\b[A-Z]{2}\d{2}(?:[ \t]+[A-Z0-9]+)*[ \t]+•{2}[\p{L}\p{N}]+|•{2}[\p{L}\p{N}]+|\[email\]/gu;
  const parts: { text: string; masked: boolean }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), masked: false });
    parts.push({ text: match[0], masked: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), masked: false });
  return parts;
}
/** The lazy scene updates HTML overlays without loading a React renderer. */
export function setHandoffText(element: HTMLElement, text: string) {
  if (element.textContent === text) return;
  element.replaceChildren(...handoffText(text).map(part => {
    if (!part.masked) return document.createTextNode(part.text);
    const span = document.createElement('span');
    span.className = 'handoff-token'; span.textContent = part.text;
    return span;
  }));
}
