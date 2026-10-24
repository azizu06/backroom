import { test, expect } from '@playwright/test';

test('OFF cannot clear a pending proof action and failed proof output stays visible', async ({ page }) => {
  await page.route('**/api/operator/session', route => route.fulfill({ json: { authorized: true } }));
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active: null } }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/operator/eval', async route => {
    await held;
    await route.fulfill({ status: 422, json: { error: 'Proof run failed. See the retained output.', auditHref: '/audit?entry=proof-1',
      result: { output: 'Answer-key mismatch: C03', exitCode: 1, failed: true } } });
  });
  await page.route('**/api/operator/llm_off', route => route.fulfill({ json: { result: { llmEnabled: false } } }));
  await page.goto('/operator');
  await page.getByRole('button', { name: 'Run scripted eval', exact: true }).click();
  await expect(page.getByRole('status').first()).toHaveText('Run scripted eval…');
  await page.getByRole('button', { name: 'Turn models OFF', exact: true }).click();
  // Wait for OFF to settle before checking that the original action still owns busy state.
  await expect(page.getByRole('region', { name: 'Latest action receipt' })).toContainText('false');
  await expect(page.getByRole('button', { name: 'Refresh demo links', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').first()).toHaveText('Run scripted eval…');
  release();
  await expect(page.getByRole('button', { name: 'Refresh demo links', exact: true })).toBeEnabled();
  const receipt = page.getByRole('region', { name: 'Latest action receipt' });
  await expect(receipt).toContainText('Answer-key mismatch: C03');
  await expect(receipt).toContainText('Exit status: 1 · failed');
  await expect(receipt.getByRole('link', { name: 'Open action audit' })).toHaveAttribute('href', '/audit?entry=proof-1');
});
