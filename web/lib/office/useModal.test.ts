import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backgroundHosts, nextTabStop, type ModalTreeNode } from '../../app/office/useModal';

function tree(children: ModalTreeNode[] = []): ModalTreeNode {
  const self: ModalTreeNode = {
    parentElement: null,
    children,
    contains(node) {
      if (node === self) return true;
      return children.some(child => child.contains(node));
    },
  };
  for (const child of children) (child as { parentElement: ModalTreeNode | null }).parentElement = self;
  return self;
}

describe('nextTabStop', () => {
  const stops = ['enter', 'overview'] as const;
  it('cycles forward and wraps', () => {
    expect(nextTabStop(stops, 'enter', false)).toBe('overview');
    expect(nextTabStop(stops, 'overview', false)).toBe('enter');
    expect(nextTabStop(stops, null, false)).toBe('enter');
    expect(nextTabStop(stops, 'outside', false)).toBe('enter');
  });
  it('stays on the splash controls across three Tabs', () => {
    let active: string | null = 'enter';
    for (let i = 0; i < 3; i++) active = nextTabStop(stops, active, false) ?? null;
    expect(active).toBe('overview');
  });
  it('cycles backward and wraps', () => {
    expect(nextTabStop(stops, 'enter', true)).toBe('overview');
    expect(nextTabStop(stops, 'overview', true)).toBe('enter');
    expect(nextTabStop(stops, null, true)).toBe('overview');
  });
  it('returns undefined when the modal has no stops', () => {
    expect(nextTabStop([], null, false)).toBeUndefined();
  });
});

describe('backgroundHosts', () => {
  it('inerts the rest of the shell and not the modal or the shell itself', () => {
    const modal = tree();
    const header = tree();
    const footer = tree();
    const shell = tree([header, modal, footer]);
    expect(backgroundHosts(shell, modal)).toEqual([header, footer]);
  });
  it('inerts siblings of a wrapper without freezing the wrapper that holds the modal', () => {
    const modal = tree();
    const aside = tree();
    const wrap = tree([aside, modal]);
    const header = tree();
    const shell = tree([header, wrap]);
    expect(backgroundHosts(shell, modal)).toEqual([aside, header]);
  });
  it('keeps the demo disclosure live and inerts only its host\'s other branches', () => {
    const modal = tree();
    const pill = tree();
    const links = tree();
    const note = tree([pill]);
    const nav = tree([links, note]);
    const header = tree();
    const shell = tree([nav, header, modal]);
    expect(backgroundHosts(shell, modal, [pill])).toEqual([links, header]);
    expect(backgroundHosts(shell, modal, [nav])).toEqual([header]);
  });
  it('inerts the whole shell when the modal is portaled outside it', () => {
    const shell = tree([tree()]);
    const modal = tree();
    expect(backgroundHosts(shell, modal)).toEqual([shell]);
    expect(backgroundHosts(null, modal)).toEqual([]);
    expect(backgroundHosts(modal, modal)).toEqual([]);
  });
});

describe('office modal wiring', () => {
  const read = (name: string) => readFileSync(new URL(`../../app/office/${name}`, import.meta.url), 'utf8');
  it('PlaySplash is a positioned role=dialog (not the top layer) that delegates focus to useModal', () => {
    const splash = read('PlaySplash.tsx');
    expect(splash).toContain('useModal');
    expect(splash).toContain("role='dialog'");
    expect(splash).toContain("aria-modal='true'");
    expect(splash).not.toContain('<dialog');
    expect(splash).not.toContain('showModal()');
    expect(splash).not.toContain("event.key === 'Tab'");
  });
  it('the hook sets inert, traps Tab, closes on Escape, and restores focus', () => {
    const source = read('useModal.ts');
    expect(source).toContain("setAttribute('inert', '')");
    expect(source).toContain("removeAttribute('inert')");
    expect(source).toContain('showModal');
    expect(source).toContain('isCloseKey');
    expect(source).toContain('.focus(');
    expect(source).toContain('opener');
  });
  it('keeps the play splash and main handoffs together, with no conflict markers', () => {
    const office = read('Office.tsx');
    expect(office).not.toMatch(/^<{7} |^={7}$|^>{7} /m);
    expect(office).toContain("from './PlaySplash'");
    expect(office).toContain('useOfficeHandoffs');
    expect(office).toContain('Enter first person');
    expect(office).toContain('<OfficeHelp />');
    expect(office).toContain('<NavDisclosure />');
    expect(office).toContain('lookOnStart={lookOnEnter}');
  });
});
