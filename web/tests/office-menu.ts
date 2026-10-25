import { expect, type Page } from '@playwright/test';

/** Wait for AJ’s sidebar + topbar shell. Controls are always visible (no corner menu). */
export async function openMenu(page: Page) {
  await expect(page.getByRole('complementary', { name: 'Office navigation' })).toBeVisible();
  await expect(page.getByTestId('office-topbar')).toBeVisible();
}

type OfficeSheet = 'overview' | 'rooms' | 'inbox' | 'audit' | 'help';

const SHEET_BUTTON: Record<OfficeSheet, string | RegExp> = {
  overview: 'Full Floor',
  rooms: 'Rooms',
  inbox: /^Inbox/,
  audit: 'Audit Wall',
  help: 'Help',
};

const SHEET_DIALOG: Record<OfficeSheet, string | RegExp> = {
  overview: 'Full Floor',
  rooms: 'Rooms',
  inbox: /^Inbox/,
  audit: 'Audit Wall',
  help: 'Help',
};

/** Open a sidebar sheet (Full Floor / Rooms / Inbox / Audit Wall / Help). */
export async function openSheet(page: Page, sheet: OfficeSheet) {
  await openMenu(page);
  const dialog = page.getByRole('dialog', { name: SHEET_DIALOG[sheet] });
  if (await dialog.isVisible().catch(() => false)) return dialog;
  await page.getByRole('complementary', { name: 'Office navigation' })
    .getByRole('button', { name: SHEET_BUTTON[sheet], exact: sheet !== 'inbox' })
    .click();
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Full Floor sheet: roster, handoffs, preview controls. */
export async function openOverviewSheet(page: Page) {
  return openSheet(page, 'overview');
}

/** Audit Wall sheet: live lobby wall, ask-why, payment kiosk (MockOffice). */
export async function openAuditSheet(page: Page) {
  return openSheet(page, 'audit');
}

/**
 * Historical name for the old panels drawer. Prefer openOverviewSheet / openAuditSheet.
 * Defaults to Full Floor (roster + handoffs + mock controls).
 */
export async function openPanels(page: Page) {
  return openOverviewSheet(page);
}

/** Room camera presets live in the Rooms sheet (not the old corner menu). */
export async function roomPreset(page: Page, name: string | RegExp) {
  await openSheet(page, 'rooms');
  return page.locator('.room-picker button').filter({
    hasText: typeof name === 'string' ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : name,
  });
}
