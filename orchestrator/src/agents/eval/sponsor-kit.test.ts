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
  const row = (label: string) => {
    const line = kit.split('\n').find(entry => entry.startsWith('|') && entry.includes(label));
    expect(line, label).toBeTruthy();
    return line ?? '';
  };
  const cited: Array<[string, { numerator: number; denominator: number }]> = [
    ['AR scripted calls', rates.arConversations],
    ['Pre-call stops', rates.precallStops],
    ['In-app call button', rates.callButton],
    ['Demo inbox agent team', rates.inboxTeam],
    ['C5 judge calls', rates.judgeCalls],
    ['Live-call approval expiry', rates.approvalExpiry],
    ['P12 GX10 cut', rates.gx10Failover],
    ['no unexecuted integration step', rates.legacyCompleteScenarios],
  ];
  for (const [label, rate] of cited) expect(row(label), label).toContain(fraction(rate));
  const pdf = rates.sourceDocumentExtractionAccuracy;
  const pdfRow = row('Recorded PDF extraction');
  expect(pdfRow).toContain(fraction(pdf));
  expect(pdfRow).toContain(`${pdf.exactItems}/${pdf.items}`);
  expect(pdfRow).toContain(scoreboard.provenance.inputs['docs/eval/pdf-extraction.json']);
});
