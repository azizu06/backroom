import { describe, expect, it } from 'vitest';
import { DEMO_GUIDE_STEPS, OFFICE_SHORTCUTS } from './guide';

describe('office guide content', () => {
  it('has unique step ids', () => {
    const ids = DEMO_GUIDE_STEPS.map(step => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents the Play hint keys and office shortcuts', () => {
    const keys = OFFICE_SHORTCUTS.flatMap(shortcut => shortcut.keys);
    for (const key of ['W', 'A', 'S', 'D', 'E', 'Esc', '↑', '←', '↓', '→', '?']) expect(keys).toContain(key);
    expect(keys.join(' ')).toMatch(/W.*A.*S.*D/s);
    expect(OFFICE_SHORTCUTS.find(shortcut => shortcut.keys.includes('Esc'))?.action).toMatch(/Exit Play/);
  });
});
