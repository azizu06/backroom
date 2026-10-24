import { describe, expect, it } from "vitest";
import { PALETTE, ROLES } from "./palette";

describe("office palette", () => {
  it("uses valid hex colours and never pure black or white", () => {
    for (const value of Object.values(PALETTE)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
      expect(value).not.toBe("#000000");
      expect(value).not.toBe("#FFFFFF");
    }
  });
  it("only maps roles onto palette colours", () => {
    const allowed = new Set<string>(Object.values(PALETTE));
    for (const value of Object.values(ROLES)) expect(allowed.has(value)).toBe(true);
  });
  it("keeps text readable on the wall (navy on cream is well above 4.5:1)", () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const [a, b] = [lum(ROLES.text), lum(ROLES.wall)].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThan(4.5);
  });
});
