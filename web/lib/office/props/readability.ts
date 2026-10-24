/** Bounded backing stores; draw code keeps its logical coordinates when the cap is hit. */
export const MAX_PROP_TEXTURE = 1024;
export function canvasTextureSize(width: number, height: number) {
  const scale = Math.min(1, MAX_PROP_TEXTURE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Wrap at words, split long identifiers, and ellipsize overflow without ever shrinking the font. */
export function canvasTextLines(text: string, measure: (text: string) => number, width: number, maxLines: number): string[] {
  let rest = text.trim().replace(/\s+/g, ' ');
  const lines: string[] = [];
  while (rest && lines.length < maxLines) {
    if (measure(rest) <= width) { lines.push(rest); break; }
    let end = rest.length;
    const last = lines.length === maxLines - 1;
    while (end > 0 && measure(rest.slice(0, end).trimEnd() + (last ? '…' : '')) > width) end--;
    if (!end) { if (measure('…') <= width) lines.push('…'); break; }
    const space = rest.lastIndexOf(' ', end);
    if (space > 0) end = space;
    lines.push(rest.slice(0, end).trimEnd() + (last ? '…' : ''));
    rest = rest.slice(end).trimStart();
  }
  return lines;
}
