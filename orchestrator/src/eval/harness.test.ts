import { describe, expect, it } from 'vitest';
import { createGx10Persona, formatReport, formatSummary, gradePlanted, runEval, scriptedPersona } from './harness';

describe('eval run', () => {
  it('prints outcome, violations, escalations, and answer-key match for each scenario', async () => {
    const result = await runEval({ persona: scriptedPersona, limit: 30 });
    expect(result.reports).toHaveLength(30);
    expect(result.elapsedMs).toBeLessThan(10 * 60 * 1000);
    expect(result.signoff).toBe('approved');
    expect(result.gradedEval).toBe('not_run');
    for (const report of result.reports) {
      expect(formatReport(report)).toMatch(/outcome=.+ violations=.+ escalations=.+ answerKeyMatch=(true|false)/);
      expect(report.answerKeyMatch).toBe(true);
      expect(report.violations).toEqual([]);
    }
    expect(formatSummary(result)).toContain('gradedEval=not_run');
  });

  it('checks the lead payment through the gateway and a payable through the state store', async () => {
    const result = await runEval({ persona: scriptedPersona });
    const lead = result.reports.find(report => report.id === 'C01');
    const payable = result.reports.find(report => report.id === 'P01');
    const duplicate = result.reports.find(report => report.id === 'P02');
    expect(lead).toMatchObject({ outcome: 'ALLOW', answerKeyMatch: true, seams: expect.arrayContaining(['gateway:payment_link', 'state:audit']) });
    expect(payable?.seams).toEqual(expect.arrayContaining(['state:audit', 'simulated:nessie']));
    expect(duplicate?.outcome).toBe('ESCALATE');
    expect(result.reports.find(report => report.id === 'C06')).toMatchObject({ outcome: 'EXACT_PAYMENT_MATCH', seams: expect.arrayContaining(['reconciliation:fixture-feed']) });
    expect(result.reports.find(report => report.id === 'C07')).toMatchObject({ outcome: 'RECON_UNMATCHED', answerKeyMatch: true });
    expect(gradePlanted('RECON_SHORT', 'EXACT_PAYMENT_MATCH')).toBe('expected EXACT_PAYMENT_MATCH got RECON_SHORT');
    expect(gradePlanted(undefined, 'RECON_UNMATCHED')).toBe('planted case not executed');
    expect(gradePlanted('RECON_UNMATCHED', 'RECON_UNMATCHED')).toBeUndefined();
    expect(result.reports.find(report => report.id === 'C19')).toMatchObject({ outcome: 'RECON_SHORT' });
    expect(result.reports.find(report => report.id === 'C20')).toMatchObject({ outcome: 'RECON_DUPLICATE' });
    expect(result.reports.find(report => report.id === 'C18')).toMatchObject({ outcome: 'ESCALATE,PASSKEY_INVALID', seams: expect.arrayContaining(['passkey:voice-rejected']) });
    expect(result.reports.find(report => report.id === 'P04')).toMatchObject({ outcome: 'ESCALATE,BANK_CHANGE_APPLIED', answerKeyMatch: true, seams: expect.arrayContaining(['crs:fixture', 'apify:fixture', 'passkey:test-authenticator', 'payment:fixture', 'payment:approved-master']) });
    expect(result.reports.find(report => report.id === 'C10')).toMatchObject({ outcome: 'ESCALATE,DISPUTE_PERSISTED', seams: expect.arrayContaining(['dial:client-stopped']) });
    expect(result.reports.find(report => report.id === 'C11')).toMatchObject({ outcome: 'ESCALATE,BANKRUPTCY_PERSISTED', seams: expect.arrayContaining(['gateway:send_payment_link', 'dial:client-stopped']) });
    expect(result.reports.find(report => report.id === 'C12')).toMatchObject({ outcome: 'DENY,OPT_OUT_PERSISTED', seams: expect.arrayContaining(['gateway:record_opt_out']) });
    expect(result.reports.find(report => report.id === 'C16')).toMatchObject({ outcome: 'ESCALATE,CLOSED_BUSINESS_STOP', seams: expect.arrayContaining(['apify:fixture', 'crs:fixture']) });
    expect(result.reports.find(report => report.id === 'C02')).toMatchObject({ outcome: 'ALLOW,PARTIALLY_PAID', seams: expect.arrayContaining(['gateway:propose_plan', 'simulated:nessie']) });
    expect(duplicate?.seams).not.toContain('simulated:nessie');
    expect(result.reports.filter(report => report.answerKeyMatch)).toHaveLength(result.reports.length);
  });

  it('asks the GX10 persona with qwen3:8b and reasoning_effort none, then keeps the policy decision', async () => {
    const calls: { url: string; body: any }[] = [];
    const persona = createGx10Persona(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'I can pay the invoice today.' } }] }));
    });
    const result = await runEval({ persona, limit: 1, ids: ['C01'] });
    expect(calls[0]?.url).toContain('/chat/completions');
    expect(calls[0]?.body.model).toBe('qwen3:8b');
    expect(calls[0]?.body.reasoning_effort).toBe('none');
    expect(result.reports[0]?.utterance).toBe('I can pay the invoice today.');
    expect(result.reports[0]?.answerKeyMatch).toBe(true);
  });
});
