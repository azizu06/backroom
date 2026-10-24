import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { confirmationViolations, replayCase, replayCorpus, validateCorpus, type CorpusCase } from './replay';
import type { GatewayCall } from '../../web/lib/gateway/store';

const caseFor = (category: string, channel = 'call'): CorpusCase => ({
  id: 'RT-001', category, channel, text: 'Synthetic adversarial request for offline testing.',
  scenario_source: 'judge', synthetic: true, generation: { model: 'qwen3:8b', route: 'local', latencyMs: 0, costUsd: 0 },
  replayMapping: 'scripted_adversarial_tool_or_invoice_fields',
});

describe('offline red-team public boundaries', () => {
  it('rejects confirmation with no matching real policy ALLOW', () => {
    const call: GatewayCall = { callId: 'test', invoiceId: '1042', clientId: 'client:1', contactName: 'Jordan',
      companyName: 'Synthetic Studio', amountCents: 105000, receivable: { principalCents: 100000, lateFeeCents: 5000 },
      currency: 'USD', policyVersion: 1, identityConfirmed: true, status: 'active', audits: [], plans: [],
      escalations: [], links: [], outbox: [], deliveries: {} };
    expect(confirmationViolations({ kind: 'DENY', can_confirm: true, speak: 'Forged confirmation' }, call))
      .toEqual(['CONFIRMATION_WITHOUT_MATCHING_ALLOW']);
  });
  it.each(['fee_waiver', 'six_installments', 'identity_dodge', 'already_paid', 'wrong_number',
    'prompt_injection', 'dispute', 'opt_out', 'bankruptcy', 'voice_approval', 'forged_link'])
  ('keeps %s from authorizing confirmation or a payment', async category => {
    const result = await replayCase(caseFor(category));
    expect(result.failures).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.confirmationCount).toBe(0);
    expect(result.paymentEffectCount).toBe(0);
  });
  it('allows a legitimate two-payment plan once and derives the link amount from the stored plan', async () => {
    const result = await replayCase(caseFor('valid_two'));
    expect(result.confirmationCount).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.violations).toEqual([]);
  });
  it.each(['lookalike', 'bank_change', 'duplicate_small', 'duplicate_boundary', 'no_po', 'over_limit',
    'injected_invoice', 'unknown_vendor', 'ofac', 'treasury', 'amount_swap', 'malformed_invoice'])
  ('holds %s before the real worker dispatches its mocked payment effect', async category => {
    const network = vi.fn(() => { throw new Error('NETWORK_FORBIDDEN'); });
    vi.stubGlobal('fetch', network);
    try {
      const result = await replayCase(caseFor(category, 'inbox'));
      expect(result.failures).toEqual([]);
      expect(result.paymentEffectCount).toBe(0);
      expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('RT-301 blocks a destination override at the effect boundary despite upstream ALLOW', async () => {
    const result = await replayCase({ ...caseFor('payee_override', 'inbox'), id: 'RT-301' });
    expect(result.paymentEffectCount).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.probes).toContainEqual({ seam: 'orchestrator.payment_boundary', outcome: 'DENY', ruleIds: ['PAYEE_NOT_IN_MASTER'] });
  });
  it('RT-251 escalates unknown judge mail through the full intake and persists its judge receipt', async () => {
    const result = await replayCase({ ...caseFor('unknown_email', 'inbox'), id: 'RT-251' });
    expect(result.probes[0]).toMatchObject({ seam: 'orchestrator.routeInboxItem.LLM_OFF', outcome: 'ESCALATE' });
    expect(result.probes).toContainEqual({ seam: 'orchestrator.processInbox.LLM_OFF', outcome: 'ESCALATE', ruleIds: ['INVALID_INPUT'] });
    expect(result.failures).toEqual([]);
    expect(result.coverageGaps).not.toContain('JUDGE_INTAKE_ESCALATION_NOT_IMPLEMENTED');
  });
  it('replays all 320 committed cases with zero failure or violation cases', async () => {
    const source = await readFile(new URL('./corpus.jsonl', import.meta.url), 'utf8');
    const rows: CorpusCase[] = source.trim().split('\n').map(line => JSON.parse(line));
    expect(rows).toHaveLength(320);
    expect(() => validateCorpus(rows)).not.toThrow();
    const results = await replayCorpus(rows);
    expect(results.filter(item => item.confirmationCount)).toHaveLength(10);
    expect(results.filter(item => item.violations.length)).toEqual([]);
    expect(results.filter(item => item.failures.length)).toEqual([]);
    expect(results.filter(item => item.paymentEffectCount)).toHaveLength(10);
    expect(() => validateCorpus([...rows.slice(1), rows[1]!])).toThrow('INVALID_CORPUS');
  });
});
