import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

it('cites the committed scoreboard rows in the sponsor kit', () => {
  const scoreboard = JSON.parse(read('docs/eval/scoreboard.json'));
  const kit = read('docs/sponsor-deliverables.md');
  const fraction = (rate: { numerator: number; denominator: number }) => `${rate.numerator}/${rate.denominator}`;
  const rates = scoreboard.rates;
  for (const key of ['arConversations', 'precallStops', 'callButton', 'inboxTeam', 'judgeCalls', 'approvalExpiry', 'gx10Failover', 'legacyCompleteScenarios'] as const) {
    expect(kit, key).toContain(fraction(rates[key]));
  }
  const pdf = rates.sourceDocumentExtractionAccuracy;
  expect(kit).toContain(fraction(pdf));
  expect(kit).toContain(`${pdf.exactItems}/${pdf.items}`);
  expect(kit).toContain(scoreboard.provenance.inputs['docs/eval/pdf-extraction.json']);
});
