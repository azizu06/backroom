/** `eval run` replays the frozen scenarios. `--graded` labels eval run #1 only after owner signoff. */
import { createGx10Persona, formatReport, formatSummary, runEval, scriptedPersona } from './harness';

const persona = process.argv.includes('--persona') && process.argv[process.argv.indexOf('--persona') + 1] === 'gx10'
  ? createGx10Persona(fetch) : scriptedPersona;
const graded = process.argv.includes('--graded');
const result = await runEval({ persona });
if (graded && result.signoff !== 'approved') {
  console.error('Refusing eval run #1 until the answer key is signed.');
  process.exit(1);
}
for (const report of result.reports) console.log(formatReport(report));
console.log(formatSummary(graded ? { ...result, gradedEval: 'run-1' } : result));
console.log('Policy decisions, planted bank-feed checks, a spoken approval rejected by the passkey verifier, the legitimate bank change applied only after a passkey, and dispute, bankruptcy, and opt-out stops. A permanently closed business blocks the call from a stubbed Apify transport while a fixture credit score stays clear. A two-payment plan stays unpaid until an exact sandbox reconciliation marks the first installment partially paid. A software passkey denies the four-payment exception, and the only saved plan is two payments with the fee kept. A software passkey denies a half-off request, and the full-pay and two-payment offers keep the full total. CRS and Apify checks for the bank change are fixtures. Other integration steps were not executed. Issue checkboxes stay open.');
if (result.reports.some(report => !report.answerKeyMatch)) process.exitCode = 1;
