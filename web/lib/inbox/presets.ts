import { northfield, northfieldChange, northfieldInvoice, northfieldSource } from '@backroom/orchestrator';
import type { InboxPreset } from './types';

const planted = [
  ['4401', 'Normal approved invoice'],
  ['4419', 'Duplicate invoice +$37'], ['4471', 'Lookalike bank change'],
  ['4481', 'No PO'], ['4482', 'Over limit'],
  ['4483', 'Sanctions'], ['4484', 'Unapproved vendor'],
] as const;
// Frozen company facts only. Never accept extracted fields or approval flags from the browser.
export const inboxPresets: InboxPreset[] = planted.map(([id, label]) => {
  const fields = northfieldInvoice(id);
  return { id, label, kind: 'invoice', senderDomain: northfieldSource(id).senderDomain,
    text: `Please process invoice #${id}.\n\n${JSON.stringify(fields, null, 2)}` };
});
for (const changeRecord of northfield.bankChanges.filter(row => ['bc-legitimate', 'bc-lookalike'].includes(row.id))) {
  const change = northfieldChange(changeRecord.id);
  inboxPresets.push({ id: changeRecord.id, label: changeRecord.id === 'bc-legitimate' ? 'Cedar bank change' : 'Lookalike bank-change email', kind: 'email',
    senderDomain: change.source.senderDomain,
    text: `Please update our payment account.\n\n${JSON.stringify(change.fields, null, 2)}` });
}
export function matchPreset(id: FormDataEntryValue | null, kind: string, senderDomain: string, text: string) {
  return inboxPresets.find(row => row.id === id && row.kind === kind && row.senderDomain === senderDomain && row.text === text.replace(/\r\n/g, '\n'));
}
export function presetFields(preset: InboxPreset) {
  return preset.kind === 'invoice' ? northfieldInvoice(preset.id) : northfieldChange(preset.id).fields;
}
