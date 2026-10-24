import { describe, expect, it } from 'vitest';
import { auditStories, currentRun, isPlumbing, whyQuestion } from './stories';
import { demoRunSnapshot } from './testing/demoRun';

describe('audit stories', () => {
  it('shows only the run since the latest Reset, grouped into the demo stories, newest first', async () => {
    const { entries, chain } = await demoRunSnapshot();
    expect(chain.valid).toBe(true);
    const run = currentRun(entries);
    expect(run[0]!.action).toBe('seed_company');
    expect(run.some(entry => entry.refs.includes('old-call'))).toBe(false);
    const stories = auditStories(entries);
    expect(stories.map(story => story.title)).toEqual(['Inbox item 9b1f2c3d', 'Payment $1,237.50 reconciled', 'Call with Jordan', 'Startup']);
    // Reducer plumbing never reaches a story; the full list keeps it.
    expect(stories.flatMap(story => story.lines).some(line => isPlumbing(line.entry))).toBe(false);
    expect(run.filter(isPlumbing).map(entry => entry.action)).toEqual(expect.arrayContaining(
      ['state.registerAgent', 'state.enqueueTask', 'state.claimTask', 'state.completeTask', 'record_event', 'set_llm_enabled']));
    for (const story of stories) expect(story.lines.length).toBeLessThanOrEqual(6);
  });

  it('writes who decided, the rule, the outcome and the amount, and marks the proof rows', async () => {
    const stories = auditStories((await demoRunSnapshot()).entries);
    const call = stories.find(story => story.kind === 'call')!;
    expect(call.total).toBe(8);
    const plan = call.lines.find(line => line.entry.action === 'propose_plan')!;
    expect(plan).toMatchObject({ who: 'Code', text: '4-payment plan proposed, over the badge limit', outcome: 'ESCALATE', rule: 'MAX_INSTALLMENTS' });
    expect(call.lines.find(line => line.proof === 'passkey')).toMatchObject({ who: 'Dana', text: 'Dana approved with a passkey' });
    // Six lines fit: proof and decisions are kept over routine rows, in recorded order.
    expect(call.lines.map(line => line.entry.action)).toEqual(['office_call_requested', 'office_call_accepted', 'verify_identity_result',
      'create_escalation', 'propose_plan', 'decide_escalation']);
    const payment = stories.find(story => story.kind === 'payment')!;
    expect(payment.lines.find(line => line.proof === 'match')).toMatchObject({ text: 'Deposit matched invoice 1042 exactly',
      rule: 'EXACT_PAYMENT_MATCH', amount: '$1,237.50' });
    const inbox = stories.find(story => story.kind === 'inbox')!;
    // The bank-change escalation joins its inbox item, not the call.
    expect(inbox.lines.map(line => line.entry.action)).toEqual(['create_escalation', 'judge_inbox_decision']);
    expect(inbox.lines[1]).toMatchObject({ text: 'Inbox bank change refused', outcome: 'DENY', rule: 'LOOKALIKE_DOMAIN +1', proof: 'deny' });
  });

  it('falls back to the whole chain and an implicit call when nothing marks the run or the dial', async () => {
    const { entries } = await demoRunSnapshot();
    const gatewayOnly = entries.filter(entry => ['verify_identity_result', 'propose_plan'].includes(entry.action) && entry.refs[0] !== 'old-call');
    expect(currentRun(gatewayOnly)).toHaveLength(2);
    expect(auditStories(gatewayOnly).map(story => story.title)).toEqual(['Call with Jordan']);
  });

  it('asks a question the evidence retriever can ground', async () => {
    const { entries } = await demoRunSnapshot();
    expect(whyQuestion(entries.find(entry => entry.action === 'propose_plan' && entry.decision === 'ESCALATE')!))
      .toBe('Why was invoice 1042 escalated to Dana under MAX_INSTALLMENTS?');
    expect(whyQuestion(entries.find(entry => entry.action === 'judge_inbox_decision')!))
      .toBe('Why was the bank change inbox item denied under LOOKALIKE_DOMAIN?');
  });
});
