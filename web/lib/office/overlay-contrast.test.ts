import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHROME, PALETTE } from "./palette";

const css = (name: string) => readFileSync(join(__dirname, "../../app/office", name), "utf8");
const tokens = new Map<string, string>();
for (const m of css("lobby.css").matchAll(/--office-([a-z]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) tokens.set(m[1]!, m[2]!.toUpperCase());

const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// [text token, plate token]: every text-on-plate combination the overlay CSS uses.
const PAIRS: Array<[string, string]> = [
  ["navy", "cream"], // captions, labels, HUD, minimap, panels, chat, story
  ["navy", "blush"], // hover states, bubbles, disconnected notice
  ["navy", "peach"], // buttons
  ["navy", "aqua"], // pressed sound toggle
  ["cream", "navy"], // Play interact button
];

describe("overlay colour tokens", () => {
  it("mirror the palette", () => {
    for (const [name, value] of tokens) expect(value).toBe(PALETTE[name as keyof typeof PALETTE]);
    expect(tokens.size).toBeGreaterThanOrEqual(8);
  });
  it.each(PAIRS)("%s text on %s plate is at least 4.5:1", (fg, bg) => {
    expect(ratio(tokens.get(fg)!, tokens.get(bg)!)).toBeGreaterThanOrEqual(4.5);
  });
  it("no overlay stylesheet still hard-codes the old dark plates", () => {
    for (const f of ["play.css", "playfeel.css", "minimap.css", "room-entry.css", "sound.css", "perf.css", "story.css", "chat.css", "tags.css", "a11y.css"]) {
      expect(css(f), f).not.toMatch(/#(272f25|30382d|141914|f3dfb9|d0d6c6)/i);
    }
  });
});

// Office chrome tokens (app/office/office-tokens.css): AJ's names, light on .office-shell, dark on .office-shell[data-theme=dark].
const block = (selector: string) => {
  const source = css("office-tokens.css");
  const start = source.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start));
};
const hexes = (text: string) => new Map([...text.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map(m => [m[1]!, m[2]!.toUpperCase()]));
const theme = (name: "light" | "dark") => {
  const light = hexes(block(".office-shell"));
  const values = name === "light" ? light : new Map([...light, ...hexes(block(".office-shell[data-theme=dark]"))]);
  // Resolve the --office-* re-pointing (var(--x)) declared on the light block.
  for (const m of block(".office-shell").matchAll(/--(office-[a-z]+):\s*var\(--([a-z-]+)\)\s*;/g)) {
    if (name === "dark" && hexes(block(".office-shell[data-theme=dark]")).has(m[1]!)) continue;
    values.set(m[1]!, values.get(m[2]!)!);
  }
  for (const [key, value] of tokens) if (!values.has(`office-${key}`)) values.set(`office-${key}`, value);
  return values;
};

// [text, plate] pairs the office chrome uses, in both themes.
const CHROME_PAIRS: Array<[string, string]> = [
  ["ink", "paper"],
  ["ink-soft", "paper"],
  ["office-navy", "office-cream"],
  ["office-slate", "office-cream"],
  ["office-navy", "office-blush"],
  ["office-navy", "office-peach"],
  ["office-navy", "office-aqua"],
  ["office-cream", "office-navy"],
];

describe.each(["light", "dark"] as const)("office chrome tokens (%s)", name => {
  const values = theme(name);
  it("use AJ's token names with the palette's values", () => {
    for (const [key, value] of Object.entries(CHROME[name])) expect(values.get(key), key).toBe(value);
  });
  it.each(CHROME_PAIRS)("%s text on %s is at least 4.5:1", (fg, bg) => {
    expect(ratio(values.get(fg)!, values.get(bg)!)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps navy ink on the pastel accent chips", () => {
    for (const accent of ["pastel-aqua", "pastel-yellow"]) expect(ratio(CHROME.light.ink, values.get(accent)!)).toBeGreaterThanOrEqual(4.5);
  });
  it("has a focus ring visible against paper", () => {
    expect(ratio(values.get("focus")!, values.get("paper")!)).toBeGreaterThanOrEqual(3);
  });
});
