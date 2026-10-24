import type { APInvoice } from "./types";

/** Domains are hostnames, not full email addresses or URLs. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}
export function isDomain(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalizeDomain(value));
}
/** Levenshtein distance (insertion, deletion, substitution). Exact matches are not lookalikes. */
export function isLookalike(known: string, candidate: string): boolean {
  const a = normalizeDomain(known), b = normalizeDomain(candidate);
  if (a === b || Math.abs(a.length - b.length) > 2) return false;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]! <= 2;
}
function items(invoice: APInvoice): string {
  // Match goods/services and quantities; compare pricing via the total tolerance below.
  return JSON.stringify(invoice.lineItems.map(item => JSON.stringify([
    item.description.trim().toLowerCase().replace(/\s+/g, " "), item.quantity,
  ])).sort());
}
export function isDuplicate(invoice: APInvoice, prior: APInvoice): boolean {
  return !(invoice.id && prior.id === invoice.id) && invoice.vendorId === prior.vendorId && items(invoice) === items(prior)
    && Math.abs(invoice.amountCents - prior.amountCents) <= Math.max(prior.amountCents * 0.05, 10000);
}
