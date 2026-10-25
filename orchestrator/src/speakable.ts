import { POLICY_SENTENCES, RULE_SENTENCES } from '@backroom/policy';

// Short descriptions of the catalog's most common demo rules. Do not bake saved
// policy limits into wording: this module describes records, never evaluates them.
const descriptions: Readonly<Record<string, string>> = {
  MAX_INSTALLMENTS: 'the installment limit',
  MIN_FIRST_PCT: 'the minimum first payment',
  MAX_PLAN_DAYS: 'the payment plan duration limit',
  FEES_NON_WAIVABLE: 'the rule against waiving late fees',
  MAX_DISCOUNT: 'the discount limit',
  OVER_LIMIT: 'the payment limit requiring human approval',
  NO_PO: 'a missing matching purchase order',
  BANK_CHANGE_HOLD: 'a bank change requiring human approval',
  LOOKALIKE_DOMAIN: 'a sender domain that resembles the vendor’s',
  DUPLICATE_INVOICE: 'a possible duplicate invoice',
  PAYEE_NOT_IN_MASTER: 'a payee missing from the approved vendor list',
  FRAUD_RISK_HOLD: 'a fraud risk requiring human review',
};

/** Wording only. Citation markers are opaque: validation and link targets keep
 * their exact bytes, while the surrounding displayed/spoken prose is cleaned. */
export function speakable(text: string): string {
  return text.split(/(\[entry:[A-Za-z0-9_.:-]+\])/g).map(part => {
    if (/^\[entry:[A-Za-z0-9_.:-]+\]$/.test(part)) return part;
    return part
      .replace(/\b[a-z][\w-]*:[\w:./#-]+\b/gi, '')
      .replace(/\b(?:INV|CASE)-([A-Za-z0-9]+)\b/gi,
        (token, id: string) => `${/^INV-/i.test(token) ? 'invoice' : 'case'} ${id}`)
      .replace(/•{2,}(\d+)/g, 'ending in $1')
      .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, token => {
        if (descriptions[token]) return descriptions[token];
        const sentence = RULE_SENTENCES[token as keyof typeof RULE_SENTENCES];
        return sentence ? POLICY_SENTENCES[sentence].replace(/\.$/, '') : token.toLowerCase().replace(/_/g, ' ');
      })
      // Opaque transport/status codes and artifact addresses add no explanation.
      .replace(/\b(?:HTTP\s*\d{3}|[A-Z]{2,}-\d+|[a-f0-9]{8}-[a-f0-9-]{27,}|[a-f0-9]{24,})\b/gi, '')
      .replace(/\b[a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+\b/g, token => token.replace(/_/g, ' ').toLowerCase())
      .replace(/\b[a-zA-Z]+(?:[A-Z][a-z0-9]+)+\b/g, token => token
        .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase())
      .replace(/\b[A-Z]{2,}\b/g, token => token.toLowerCase())
      .replace(/[`{}<>]|(?:-+>|=>)|[\x00-\x1f\x7f]/g, ' ')
      .replace(/\(\s*\)|\[\s*\]/g, '')
      .replace(/\s+/g, ' ');
  }).join('').trim();
}
