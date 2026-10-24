import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE } from "./palette";

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
