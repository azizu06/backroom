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
console.log('Policy decisions only. Integration steps were not executed. Issue checkboxes stay open.');
if (result.reports.some(report => !report.answerKeyMatch)) process.exitCode = 1;
