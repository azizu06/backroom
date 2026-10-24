import { handoffText } from '../../../lib/office/handoff-text';

export function HandoffText({ text }: { text: string }) {
  return handoffText(text).map((part, i) => part.masked ? <span key={i} className='handoff-token'>{part.text}</span> : part.text);
}
