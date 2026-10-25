import { test, expect } from '@playwright/test';
import { handoffFromRow } from '../lib/office/handoffs';
import { agentChatTimeline } from '../lib/office/agent-chat';
import { planHandoffs } from '../lib/office/handoff-plan';

test('operator starts overlapping real cases once, with bank-change held and no money movement', async ({ page, request }, info) => {
  test.setTimeout(60_000);
  const origin = 'http://127.0.0.1:3057';
  await page.goto('/inbox');
  await expect(page.getByRole('button', { name: 'Start the workday' })).toHaveCount(0);
  expect((await request.post('/api/operator/workday', { headers: { origin } })).status()).toBe(401);
  expect((await page.request.post('/api/session', { headers: { origin }, data: { code: 'workday-test-operator' } })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Start the workday' }).click();
  await expect(page.getByRole('status')).toContainText('Workday running');
  const repeat = await page.request.post('/api/operator/workday', { headers: { origin } });
  expect(await repeat.json()).toMatchObject({ started: false, status: 'running', message: expect.stringContaining('already') });
  let proof: any;
  await expect(async () => {
    proof = await (await request.get('/__workday/proof')).json();
    expect(proof.batch?.status, JSON.stringify(proof.batch)).toBe('done');
  }).toPass({ timeout: 30_000 });
  await info.attach('real-workday-proof.json', { body: JSON.stringify(proof, null, 2), contentType: 'application/json' });
  const receipts = proof.audit.filter((row: any) => row.action === 'judge_inbox_decision');
  expect(receipts).toHaveLength(4);
  for (const invoice of ['4401', '4481', '4482']) {
    const receipt = receipts.find((row: any) => row.inputs.fields?.invoiceId === invoice);
    const rows = proof.rows.filter((row: any) => row.handoffId.startsWith(`agent:${receipt.refs[0]}:`));
    expect(rows.map((row: any) => `${row.fromRole}>${row.toRole}`)).toEqual(['intake>extractor', 'extractor>vendor', 'vendor>payables', 'payables>auditor']);
  }
  expect(new Set(proof.rows.map((row: any) => row.caseDisplayId)).size).toBe(4);
  expect(proof.audit.some((row: any) => row.action === 'workday_attack_held')).toBe(true);
  const attackReceipt = receipts.find((row: any) => row.inputs.fields?.kind === 'bank_change');
  expect(attackReceipt.decision).toBe('ESCALATE');
  expect(attackReceipt.ruleIds).toContain('LOOKALIKE_DOMAIN');
  expect(proof.audit.filter((row: any) => row.action === 'workday_invoice_hold')).toHaveLength(3);
  expect(proof.audit.some((row: any) => ['pay_invoice', 'nessie_completed'].includes(row.action))).toBe(false);
  expect(proof.usage.reservedUsd).toBe(0);
  // Feed real public rows to the office's existing planner: independent couriers overlap between desks.
  const rows = proof.rows.map(handoffFromRow).filter(Boolean);
  const plan = planHandoffs(rows);
  const captions = agentChatTimeline(plan, 'Live handoff');
  expect(captions.some(cue => cue.text.includes('Intake: sort document (INV-4401) → Extractor: read fields'))).toBe(true);
  expect(captions.some(cue => cue.text.includes('Vendor: verify domain/CRS'))).toBe(true);
  const caseFor = new Map(rows.map((row: any) => [row.handoffId, row.caseDisplayId]));
  expect(plan.legs.some(a => plan.legs.some(b => a.actor !== b.actor && caseFor.get(a.handoffId) !== caseFor.get(b.handoffId)
    && Math.max(a.start, b.start) < Math.min(a.end, b.end)))).toBe(true);
  expect(await (await page.request.post('/api/operator/workday', { headers: { origin } })).json()).toMatchObject({ started: false, status: 'done' });
  await page.screenshot({ path: info.outputPath('workday-inbox.png'), fullPage: true });
  // AJ owns the changing menu entry point. Verify the office and its panel by direct load.
  await page.goto('/office?view=plan');
  await expect(page.locator('.office-shell')).toBeVisible();
  const panel = page.locator('section[aria-label="Workday"]');
  await expect(panel).toContainText('INV-4401');
  await expect(panel).toContainText('Auditor: completed');
  await expect(panel).toContainText('Vendor: held for review');
  await page.screenshot({ path: info.outputPath('workday-office.png'), fullPage: true });
});
