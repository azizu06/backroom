import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text pairs used by the shared page palette (app/theme.css) must stay >= 4.5:1 in both themes.
const css = readFileSync(join(__dirname, '../app/theme.css'), 'utf8');
function block(selector: string) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return new Map([...body.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map(m => [m[1]!, m[2]!]));
}
const light = block(':root');
const dark = new Map([...light, ...block(":root[data-theme='dark']")]);

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const pairs: Array<[string, string]> = [['ink', 'paper'], ['ink-soft', 'paper'], ['ink', 'field'], ['ink', 'danger-soft'],
  ['on-pastel', 'pastel-aqua'], ['on-pastel', 'pastel-yellow'], ['paper', 'ink'], ['ink-soft', 'line']];

describe('shared page palette contrast', () => {
  for (const [name, tokens] of [['light', light], ['dark', dark]] as const) {
    it.each(pairs)(`${name}: --%s on --%s is >= 4.5:1`, (text, plate) => {
      expect(contrast(tokens.get(text)!, tokens.get(plate)!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
