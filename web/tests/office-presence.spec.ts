import { test, expect } from '@playwright/test';

test('viewers in the same browser context see each other and expire', async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  const errors: string[] = [];
  first.on('pageerror', error => errors.push(error.message));
  second.on('pageerror', error => errors.push(error.message));
  await Promise.all([first.goto('/office?presence=1&presenceTtl=1500&view=overview'), second.goto('/office?presence=1&presenceTtl=1500&view=overview')]);
  await expect(first.getByText('2 viewing')).toBeVisible({ timeout: 8000 });
  await expect(second.getByText('2 viewing')).toBeVisible({ timeout: 8000 });
  await second.close();
  await expect(first.getByText('1 viewing')).toBeVisible({ timeout: 8000 });
  expect(errors).toEqual([]);
  await context.close();
});
