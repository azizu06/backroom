// Display aliases from fixtures/company/northfield.json; no provider or bank data.
const VENDORS: Record<string, string> = {
  "acme": "Acme Supply",
  "papertrail": "Papertrail Print Co",
  "cedar": "Cedar Freight",
  "baylight": "Baylight Lighting",
  "studio-clean": "Studio Clean Services",
  "loom": "Loom Textile Works",
  "mint": "Mint Office Plants",
  "harbor": "Harbor Hardware",
  "pixel": "Pixel Equipment Rental",
  "oak": "Oak Desk Repair",
  "atlas": "Atlas Courier",
  "cobalt": "Cobalt Cloud Hosting",
  "maple": "Maple Catering",
  "echo": "Echo Acoustic Panels",
  "stone": "Stone Street Storage",
  "sable": "Sable Packaging",
  "northstar": "Northstar Safety",
  "birch": "Birch Bookkeeping",
  "silver": "Silverline Signage",
  "river": "River Water Service",
  "juniper": "Juniper IT Support",
  "spark": "Spark Electrical",
  "beacon": "Beacon Insurance",
  "sanctions-test": "Synthetic OFAC Test Vendor",
  "unverified": "Unverified Pop-up Supplies"
};
/** Display-only formatting. Receipt and runtime identifiers remain untouched in state and links. */
export const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function plainWords(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function officeText(text: string): string {
  const named = text.replace(/\b(?:vendor[-_:])?([a-z]+(?:-[a-z]+)*)\b/g, (token, id: string) => VENDORS[id] ?? token);
  return named
    .replace(/\b(-?\d[\d,]*)\s+(?:USD\s+)?cents?\b/gi, (_, n: string) => dollars(Number(n.replaceAll(',', ''))))
    .replace(/\bdemo-(?:collections|payables|vendor)-(\d+)\b/gi, 'INV-$1')
    .replace(/\b(?:audit|judge|review|escalation):[^\s·,;]+/gi, '')
    .replace(/\b(?:agent-)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '')
    .replace(/\bvendor[-_:]([a-z][a-z0-9_-]*)/gi, (_, name: string) => plainWords(name))
    .replace(/\bvendorId\b/g, 'vendor')
    .replace(/\b(create escalation|agent narration hold|judge inbox decision)\b(?:\s*·\s*(?:agent-[^·]*|[,\s\d]+))?/gi,
      (_, action: string) => action.toLowerCase() === 'create escalation' ? 'Escalated to Dana' : 'Held for review')
    .replace(/\bagent-(?=\s*(?:,|·|$))/gi, '')
    .split('·').map(part => part.replace(/^(?:\s*,)+|(?:,\s*)+$/g, '')
      .replace(/,\s*(?:,\s*)+/g, ', ').trim())
    .filter(Boolean).join(' · ').replace(/\s{2,}/g, ' ').trim();
}
export function shortOfficeText(text: string, limit = 40): string {
  const clean = officeText(text), points = Array.from(clean);
  if (points.length <= limit) return clean;
  const prefix = points.slice(0, limit).join('');
  return /\s/.test(clean) && !/\s/.test(points[limit]!) ? prefix.replace(/\s+\S*$/, '').trimEnd() : prefix.trimEnd();
}
export function invoiceLabel(text: string): string | undefined {
  return officeText(text).match(/\bINV-[\w]+\b/i)?.[0]
    ?? text.match(/\binvoice\s+(\d+)\b/i)?.[1]?.replace(/^(.*)$/, 'INV-$1');
}
export function badgeLimit(key: string, value: unknown): readonly [string, string] {
  const names: Record<string, string> = { maxPaymentCents: 'Maximum payment', minFirstPct: 'Minimum first payment',
    maxInstallments: 'Maximum installments', maxPlanDays: 'Maximum plan days', maxDiscountPct: 'Maximum discount' };
  const label = names[key] ?? plainWords(key);
  const display = typeof value === 'number' && /Cents$/.test(key) ? dollars(value)
    : typeof value === 'number' && /Pct$/.test(key) ? `${value}%`
    : typeof value === 'boolean' ? value ? 'yes' : 'no'
    : value === null || value === undefined ? 'Not specified'
    : Array.isArray(value) ? value.map(item => badgeLimit('', item)[1]).join(', ')
    : typeof value === 'object' ? Object.entries(value).map(([k, v]) => badgeLimit(k, v).join(': ')).join('; ')
    : officeText(String(value));
  return [label, display];
}
