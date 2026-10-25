import type { Page } from '@playwright/test';

/** /office keeps every control in one corner menu, closed by default; the footer panels open from it into a drawer. */
export async function openMenu(page: Page) {
  const toggle = page.getByRole('button', { name: 'Backroom menu' });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

export async function openPanels(page: Page) {
  const panels = page.locator('.office-corner .office-drawer-toggle');
  if (await panels.getAttribute('aria-expanded') === 'true') return;
  await openMenu(page);
  await panels.click();
}
