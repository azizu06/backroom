import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { judgeGateway, judgeVoice, localJudgeOrigin, virtualDana } from './judge-path.helpers';

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
  const stoppedTerms = { installments: 1, first_payment_pct: 100, duration_days: 0, waive_fee: false, discount_pct: 0 };
  async function stoppedState(id: string) {
    const response = await request.post(`${origin}/__judge/state`, {
      headers: { authorization: 'Bearer judge-local-tool' }, data: { callId: id },
    });
    expect(response.ok()).toBe(true);
    const state = await response.json();
    expect(state.session.stopped).toBe(true);
    expect(state.call.plans).toEqual([]);
    expect(state.call.links).toEqual([]);
    expect(state.call.outbox.some((item: any) => item.type === 'send_payment_link')).toBe(false);
    await info.attach(`stopped-call-${id}`, { body: JSON.stringify(state), contentType: 'application/json' });
    return state;
  }
  await test.step('Human request creates Dana callback on controller without money', async () => {
    const id = randomUUID();
    const relay = await judgeVoice(request, origin, id);
    await relay.turn('user', 'Yes, this is Jordan.');
    expect(await relay.tool('verify_identity_result', { result: 'confirmed' })).toMatchObject({ identity: 'confirmed' });
    await relay.turn('user', 'I want to talk to a human.');
    expect(await relay.tool('propose_plan', stoppedTerms)).toMatchObject({ kind: 'DENY', rule_ids: ['CALL_STOPPED'] });
    await page.goto(`${origin}/controller`);
    await expect(page.getByRole('heading', { name: 'Approval needed' })).toBeVisible();
    await expect(page.getByText('REQUEST_HUMAN', { exact: true })).toBeVisible();
    const inbox = await (await page.request.get(`${origin}/api/controller/inbox`)).json();
    const callback = inbox.escalations.find((row: any) => row.id === `callback:${id}`);
    expect(callback).toMatchObject({ callId: id, toHuman: 'Dana', status: 'pending', ruleIds: ['REQUEST_HUMAN'] });
    expect(callback).not.toHaveProperty('amountCents');
    expect(callback).not.toHaveProperty('requestedTerms');
    await relay.complete();
    expect((await stoppedState(id)).call.status).toBe('human_requested');
  });
  await test.step('Hostility after one scripted calm reply records HOSTILE_ESCALATE', async () => {
    const id = randomUUID();
    const relay = await judgeVoice(request, origin, id);
    await relay.turn('user', 'Yes, this is Jordan.');
    await relay.tool('verify_identity_result', { result: 'confirmed' });
    await relay.turn('user', 'You people are thieves.');
    await relay.turn('assistant', 'I understand this is frustrating. We can pause and have a person help.');
    await relay.turn('user', 'I am done talking to a robot.');
    await relay.tool('request_human', { reason: 'hostile' });
    expect(await relay.tool('propose_plan', stoppedTerms)).toMatchObject({ kind: 'DENY', rule_ids: ['CALL_STOPPED'] });
    const audit = await (await page.request.get(`${origin}/api/audit/entries`)).json();
    expect(audit.entries.some((row: any) => row.refs.includes(id) && row.action === 'request_human'
      && row.ruleIds.includes('HOSTILE_ESCALATE'))).toBe(true);
    await relay.complete();
    expect((await stoppedState(id)).call.status).toBe('human_requested');
  });
  await test.step('Wrong person receives code-owned closing line without invoice or amount', async () => {
    const id = randomUUID();
    const relay = await judgeVoice(request, origin, id);
    await relay.turn('user', 'No, wrong number.');
    const result = await relay.tool('verify_identity_result', { result: 'confirmed' });
    expect(result).toMatchObject({ identity: 'wrong_person', next_step: 'say_and_end', can_confirm: false });
    expect(result.speak).toContain('Northfield Studio');
    expect(result.speak).toContain('202-555-0100');
    for (const detail of ['Jordan', '1042', '4,950', '495000', '$']) expect(result.speak).not.toContain(detail);
    expect(result).not.toHaveProperty('amount_cents');
    expect(result).not.toHaveProperty('invoice_id');
    expect(await relay.tool('get_invoice_context')).toMatchObject({ kind: 'DENY', rule_ids: ['CALL_STOPPED'] });
    await relay.turn('assistant', result.speak);
    await relay.complete();
    const state = await stoppedState(id);
    expect(state.call.identityConfirmed).toBe(false);
    expect(state.call.status).toBe('human_requested');
  });
  await test.step('Dispute stops collection and refuses any offer', async () => {
    const id = randomUUID();
    const relay = await judgeVoice(request, origin, id);
    await relay.turn('user', 'Yes, this is Jordan.');
    await relay.tool('verify_identity_result', { result: 'confirmed' });
    await relay.turn('user', 'I dispute this invoice.');
    expect(await relay.tool('mark_dispute')).toMatchObject({ kind: 'RECORDED', can_confirm: false });
    expect(await relay.tool('propose_plan', stoppedTerms)).toMatchObject({ kind: 'DENY', rule_ids: ['CALL_STOPPED'] });
    await relay.complete();
    const state = await stoppedState(id);
    expect(state.call.status).toBe('disputed');
    expect(state.call.audits.some((row: any) => row.action === 'mark_dispute' && row.ruleIds.includes('MARK_DISPUTE'))).toBe(true);
  });
  await dana.detach();
});
