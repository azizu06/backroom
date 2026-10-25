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

// Office chrome: --office-* mappings (app/office/office-tokens.css) resolved against the shared palette (app/theme.css).
const shared = readFileSync(join(__dirname, "../../app/theme.css"), "utf8");
const office = css("office-tokens.css");
const body = (source: string, selector: string) => {
  const start = source.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start));
};
const hexes = (text: string) => new Map([...text.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map(m => [m[1]!, m[2]!.toUpperCase()]));
const DARK = ":root[data-theme='dark'] .office-shell";
const theme = (name: "light" | "dark") => {
  const values = hexes(body(shared, ":root"));
  if (name === "dark") for (const [k, v] of hexes(body(shared, ":root[data-theme='dark']"))) values.set(k, v);
  const overrides = name === "dark" ? hexes(body(office, DARK)) : new Map<string, string>();
  for (const m of body(office, ".office-shell").matchAll(/--(office-[a-z]+):\s*var\(--([a-z-]+)\)\s*;/g)) {
    expect(values.has(m[2]!), `--${m[2]} comes from theme.css`).toBe(true);
    values.set(m[1]!, overrides.get(m[1]!) ?? values.get(m[2]!)!);
  }
  for (const [key, value] of overrides) values.set(key, value);
  for (const [key, value] of tokens) if (!values.has(`office-${key}`)) values.set(`office-${key}`, value);
  return values;
};

// Dark panels carry --ink on --paper; pastel plates (yellow, aqua, blush) carry --on-pastel navy ink in both themes.
const PANEL_PAIRS: Array<[string, string]> = [
  ["ink", "paper"],
  ["ink-soft", "paper"],
  ["office-navy", "office-cream"],
  ["office-slate", "office-cream"],
  ["office-cream", "office-navy"], // Play interact button, pressed agent-talk chips
];
const PASTEL_PLATES = ["office-peach", "office-aqua", "office-blush", "pastel-aqua", "pastel-yellow"];
const PASTEL_TEXT_SELECTORS = [".play-chat-off button", ".coworker-bubble", ".office-disconnected", ".room-inspector button", ".play-panel button", ".story-mode button",
  ".office-sound-toggle[aria-pressed='true']", ".agent-talk-line", ".agent-talk-recent li[data-tone='fail']", ".agent-talk-recent li[data-tone='correction']"];

describe.each(["light", "dark"] as const)("office chrome on the shared palette (%s)", name => {
  const values = theme(name);
  it("keeps the pastel accents on peach and aqua plates", () => {
    expect(values.get("office-peach")).toBe(values.get("pastel-yellow"));
    expect(values.get("office-aqua")).toBe(values.get("pastel-aqua"));
    expect(values.get("office-navy")).toBe(values.get("ink"));
    expect(values.get("office-cream")).toBe(values.get("paper"));
  });
  it.each(PANEL_PAIRS)("%s text on %s is at least 4.5:1", (fg, bg) => {
    expect(ratio(values.get(fg)!, values.get(bg)!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(PASTEL_PLATES)("--on-pastel ink on %s is at least 4.5:1", plate => {
    expect(ratio(values.get("on-pastel")!, values.get(plate)!)).toBeGreaterThanOrEqual(4.5);
  });
  it("has a focus ring (--ink) visible against paper", () => {
    expect(office).toMatch(/:focus-visible \{ outline-color: var\(--ink\); \}/);
    expect(ratio(values.get("ink")!, values.get("paper")!)).toBeGreaterThanOrEqual(3);
  });
});

describe("office chrome dark theme", () => {
  const dark = office.slice(office.indexOf(`${DARK} {`));
  it("defines no shared tokens itself", () => {
    expect(office).not.toMatch(/--(ink|ink-soft|paper|line|pastel-aqua|pastel-yellow|on-pastel|focus):/);
  });
  it("uses AJ's deep lavender and no invented plate overrides", () => {
    expect(theme("dark").get("office-lavender")).toBe("#34406A");
    expect(dark).not.toMatch(/--office-(peach|aqua|blush|plate-shadow):/);
  });
  it("gives every pastel plate --on-pastel ink", () => {
    const rule = dark.slice(dark.indexOf(":is("), dark.indexOf("{ color: var(--on-pastel); }"));
    expect(rule.length).toBeGreaterThan(0);
    for (const selector of PASTEL_TEXT_SELECTORS) expect(rule, selector).toContain(selector);
  });
});
