import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { judgeGateway, localJudgeOrigin, virtualDana } from './judge-path.helpers';

test('judge invoice, attack, passkey exception and exact payment finish the agent chains', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const origin = localJudgeOrigin('http://localhost:3049');
  const callId = randomUUID();
  const tool = judgeGateway(request, origin, 'judge-local-tool', callId);
  const host = async (action: string) => {
    const result = await request.post(`${origin}/__judge/${action}`, {
      headers: { authorization: 'Bearer judge-local-tool' }, data: { callId },
    });
    expect(result.ok()).toBe(true);
  };
  const dana = await virtualDana(page);
  await test.step('Invoice produces the intake through auditor chain on the real audit wall', async () => {
    await page.goto(`${origin}/inbox`);
    const submitted = page.waitForResponse(r => r.url().endsWith('/api/inbox') && r.request().method() === 'POST');
    await page.getByRole('button', { name: /Normal approved invoice/ }).click();
    const receipt = await (await submitted).json();
    const caseId = `agent:${receipt.id}`;
    await expect(page.getByRole('region', { name: 'Decision receipt' })).toBeVisible();
    await page.goto(`${origin}/audit`);
    await page.getByLabel('Operator code').fill('judge-local-controller');
    await page.getByRole('button', { name: 'Open audit wall' }).click();
    await expect(async () => {
      const res = await page.request.get(`${origin}/api/audit/entries`);
      const body = await res.json();
      expect(body.entries.some((e: any) => e.action === 'case_summary' && e.inputs.caseId === caseId)).toBe(true);
      expect((body.entries ?? []).filter((e: any) => e.action === 'agent_handoff_completed' && e.refs.includes(caseId))
        .map((e: any) => `${e.inputs.fromRole}>${e.inputs.toRole}`))
        .toEqual(expect.arrayContaining(['intake>extractor', 'extractor>vendor', 'vendor>payables', 'payables>auditor']));
    }).toPass({ timeout: 15_000 });
    await page.screenshot({ path: info.outputPath('invoice-audit.png'), fullPage: true });
  });
  await test.step('Attack bank change is held with no money movement', async () => {
    await page.goto(`${origin}/attack`);
    await page.getByRole('button', { name: /^Lookalike vendor changes bank details / }).click();
    await page.getByRole('button', { name: 'Run attack' }).click();
    await expect(page.locator('.attack-decision')).toContainText('BANK_CHANGE_HOLD');
    await expect(page.getByText('Money moved: no · Payment attempts: 0', { exact: true })).toBeVisible();
  });
  await test.step('Real gateway escalates seven installments at fifteen percent to Dana', async () => {
    await host('call');
    expect(await tool('verify_identity_result', { result: 'confirmed' })).toMatchObject({ kind: 'RECORDED' });
    await page.goto(`${origin}/controller`);
    await page.getByLabel('Controller enrollment code').fill('judge-local-controller');
    await page.getByRole('button', { name: 'Create Dana’s passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Dana’s passkey is ready.' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in with passkey' }).click();
    await expect(page.getByRole('heading', { name: 'All clear.' })).toBeVisible();
    const proposed = await tool('propose_plan', { installments: 7, first_payment_pct: 15,
      duration_days: 30, waive_fee: false, discount_pct: 0 });
    expect(proposed.kind).toBe('ESCALATE');
    await expect(page.getByRole('heading', { name: 'Approval needed' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve with passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Your decision is recorded.' })).toBeVisible();
    const checked = await tool('check_approval', { escalation_id: proposed.escalation_id });
    expect(checked).toMatchObject({ kind: 'ALLOW', approval_status: 'approved', can_confirm: true });
    const link = await tool('send_payment_link', { plan_id: checked.plan_id });
    expect(link.kind).toBe('RECORDED');
    await page.goto(`${origin}/calls`);
    await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Payment link · ready' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment link ready' })).toBeVisible();
    await page.goto(`${origin}${link.link_path}`);
    await page.getByRole('button', { name: 'Pay $743.00', exact: true }).click();
    await expect(page.getByText('Payment matched. Invoice partially paid.')).toBeVisible();
    await page.screenshot({ path: info.outputPath('payment.png'), fullPage: true });
  });
  await test.step('Call completion emits collections, reconciler and auditor evidence', async () => {
    const before = await (await page.request.get(`${origin}/api/audit/entries`)).json();
    const seen = new Set(before.entries.map((e: any) => e.id));
    await host('end');
    let evidence: any;
    await expect(async () => {
      const response = await page.request.get(`${origin}/api/audit/entries`);
      const body = await response.json();
      expect(body.chain.valid).toBe(true);
      const fresh = body.entries.filter((e: any) => !seen.has(e.id));
      expect(fresh.some((e: any) => e.action === 'case_summary' && e.inputs.caseId === `agent:call:${callId}`)).toBe(true);
      expect(fresh.some((e: any) => e.action === 'agent_reconciliation' && e.refs.includes('1042')
        && e.ruleIds.includes('EXACT_PAYMENT_MATCH') && e.inputs.invoiceState === 'partially_paid')).toBe(true);
      evidence = body;
      expect(fresh.filter((e: any) => e.action === 'agent_handoff_completed' && e.refs.includes(`agent:call:${callId}`))
        .map((e: any) => `${e.inputs.fromRole}>${e.inputs.toRole}`))
        .toEqual(expect.arrayContaining(['collections>reconciler', 'reconciler>auditor']));
    }).toPass({ timeout: 15_000 });
    await info.attach('audit-chain', { body: JSON.stringify(evidence), contentType: 'application/json' });
  });
  await dana.detach();
});
