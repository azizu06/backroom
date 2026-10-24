/** `eval run` for the text harness. This is not graded eval run #1; the answer key is still unsigned. */
import { createGx10Persona, formatReport, formatSummary, runEval, scriptedPersona } from './harness';

const persona = process.argv.includes('--persona') && process.argv[process.argv.indexOf('--persona') + 1] === 'gx10'
  ? createGx10Persona(fetch) : scriptedPersona;
const result = await runEval({ persona });
for (const report of result.reports) console.log(formatReport(report));
console.log(formatSummary(result));
if (result.reports.some(report => !report.answerKeyMatch)) process.exitCode = 1;
