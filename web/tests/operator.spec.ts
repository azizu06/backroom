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
  await page.getByText('Advanced', { exact: true }).click();
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

test('x402 buttons label each rail, explain an unavailable testnet and show the hold proof', async ({ page }) => {
  await page.route('**/api/operator/session', route => route.fulfill({ json: { authorized: true,
    x402Testnet: { available: false, reason: 'Testnet is off. Restart the demo host with X402_LIVE=1 to opt in. Simulated is available.' } } }));
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active: null } }));
  await page.route('**/api/operator/x402_simulated', route => route.fulfill({ json: { auditHref: '/audit?entry=op-1', result: {
    rail: 'x402 simulated', note: 'Simulated money', scenario: 'simulated', status: 'paid', amount: '$1,250.00', asset: 'simulated USDC',
    vendor: 'Acme Supply (demo)', invoiceId: 'acme-x402-simulated-1', recipient: '0xf3582f2183d22BB09d9AA2B1aC7f721eC4f61180',
    policy: { decision: 'ALLOW', ruleIds: [] }, transaction: `0x${'ab'.repeat(32)}`, proof: { vendorRequests: 2, signatures: 1 },
    paymentAuditHref: '/audit?entry=pay-1' } } }));
  await page.route('**/api/operator/x402_blocked', route => route.fulfill({ json: { result: {
    rail: 'x402 simulated', scenario: 'blocked', status: 'held', amount: '$2,450.00', policy: { decision: 'ESCALATE', ruleIds: ['OVER_LIMIT'] },
    holdId: 'x402-console-hold:1', proof: { vendorRequests: 0, signatures: 0 }, paymentAuditHref: '/audit?entry=hold-1' } } }));
  await page.goto('/operator');
  await expect(page.getByRole('button', { name: 'Pay vendor with x402 · TESTNET', exact: true })).toBeDisabled();
  await expect(page.getByText('Unavailable: Testnet is off.')).toBeVisible();
  await page.getByRole('button', { name: 'Pay vendor with x402 · SIMULATED', exact: true }).click();
  const result = page.getByRole('definition').filter({ hasText: 'X402 SIMULATED' });
  await expect(result).toBeVisible();
  const facts = page.getByLabel('x402 payment result');
  await expect(facts).toContainText('$1,250.00');
  await expect(facts).toContainText('simulated hash, not on any chain');
  await expect(facts.getByRole('link', { name: 'Open payment audit' })).toHaveAttribute('href', '/audit?entry=pay-1');
  await page.getByRole('button', { name: 'Try blocked x402 invoice · SIMULATED', exact: true }).click();
  await expect(facts).toContainText('ESCALATE · OVER_LIMIT');
  await expect(facts).toContainText('0 signatures · 0 vendor requests');
});

test('demo steps are visible in order and diagnostics stay collapsed', async ({ page }) => {
  await page.route('**/api/operator/session', route => route.fulfill({ json: { authorized: true } }));
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active: null } }));
  await page.route('**/api/operator/reset', route => route.fulfill({ json: { result: { publicUrl: 'https://demo.example', stateStore: 'memory' }, auditHref: '/audit?entry=r1' } }));
  await page.goto('/operator');
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText(
    ['Reset company', 'Start the call', 'Dana’s controller', 'Payment link', 'Pay a vendor (x402)', 'Show the guardrails']);
  await expect(page.locator('[data-operator-slot="x402"]')).toBeVisible();
  for (const name of ['Run preflight', 'Run scripted eval', 'Turn models OFF', 'Preview month burst']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
  }
  await expect(page.getByRole('link', { name: 'Open the office' })).toHaveAttribute('href', '/office');
  await page.getByRole('button', { name: 'Reset company', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset company' }).click();
  await expect(page.getByRole('link', { name: 'https://demo.example/controller' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Dana's controller/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reload the office' })).toBeVisible();
});
