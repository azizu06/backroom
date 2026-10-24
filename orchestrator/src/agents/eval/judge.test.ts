import { afterEach, expect, it, vi } from 'vitest';
import { JUDGE_CASES, runJudgeCase, type JudgeCase } from './judge';

afterEach(() => vi.unstubAllGlobals());

it.each(Object.keys(JUDGE_CASES) as JudgeCase[])('judge %s: unrecognized ends ESCALATE, every row tagged scenario_source judge', async name => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runJudgeCase(name);
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
});

it('an invented tool is answered with ESCALATE, not an error, and pauses the call', async () => {
  const run = await runJudgeCase('invented_tool');
  expect(run.responses.at(-1)).toEqual({ tool: 'apply_owner_discount', status: 200, kind: 'ESCALATE' });
  expect(run).toMatchObject({ callStatus: 'human_requested', caseStatus: 'held', terminalDecision: 'ESCALATE' });
});
