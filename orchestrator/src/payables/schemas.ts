import { domain, validDomain } from './decisions';
import type { InboxSource, InvoiceFields, VendorFields } from './types';
export interface Schema<T> { parse(value: unknown): T; jsonSchema: unknown }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      !keys.every(key => Object.hasOwn(value, key))) throw new Error('INVALID_FIELDS');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/.test(value)) throw new Error('INVALID_IDENTIFIER');
  return value;
}
function cents(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('INVALID_AMOUNT');
  return Number(value);
}
function host(value: unknown): string {
  if (!validDomain(value)) throw new Error('INVALID_DOMAIN');
  return domain(value);
}
const identifier = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$' };
const objectSchema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const lineProperties = { description: { type: 'string', minLength: 1, maxLength: 200 }, quantity: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 }, unitPriceCents: { type: 'integer', minimum: 1 } };
export const invoiceSchema: Schema<InvoiceFields> = {
  jsonSchema: objectSchema({ kind: { const: 'invoice' }, invoiceId: identifier, vendorId: identifier,
    poId: { anyOf: [identifier, { type: 'null' }] }, amountCents: { type: 'integer', minimum: 1 },
    currency: { const: 'USD' }, bankAccountId: identifier, lineItems: { type: 'array', minItems: 1, maxItems: 100, items: objectSchema(lineProperties) } }),
  parse(value) {
    const row = record(value, ['kind', 'invoiceId', 'vendorId', 'poId', 'amountCents', 'currency', 'bankAccountId', 'lineItems']);
    if (row.kind !== 'invoice' || row.currency !== 'USD' || !Array.isArray(row.lineItems) || !row.lineItems.length || row.lineItems.length > 100) throw new Error('INVALID_INVOICE');
    const lineItems = row.lineItems.map(value => {
      const item = record(value, ['description', 'quantity', 'unitPriceCents']);
      if (typeof item.description !== 'string' || !item.description.trim() || item.description.length > 200 ||
          typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1000000) throw new Error('INVALID_LINE_ITEM');
      return { description: item.description.trim(), quantity: item.quantity, unitPriceCents: cents(item.unitPriceCents) };
    });
    const amountCents = cents(row.amountCents);
    if (Math.round(lineItems.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0)) !== amountCents) throw new Error('TOTAL_MISMATCH');
    return { kind: 'invoice', invoiceId: id(row.invoiceId), vendorId: id(row.vendorId), poId: row.poId === null ? null : id(row.poId),
      amountCents, currency: 'USD', bankAccountId: id(row.bankAccountId), lineItems };
  },
};
export const vendorSchema: Schema<VendorFields> = {
  jsonSchema: objectSchema({ kind: { enum: ['bank_change', 'vendor'] }, vendorId: identifier,
    domain: { type: 'string', maxLength: 253 }, bankAccountId: identifier }),
  parse(value) {
    const row = record(value, ['kind', 'vendorId', 'domain', 'bankAccountId']);
    if (row.kind !== 'bank_change' && row.kind !== 'vendor') throw new Error('INVALID_VENDOR_REQUEST');
    return { kind: row.kind, vendorId: id(row.vendorId), domain: host(row.domain), bankAccountId: id(row.bankAccountId) };
  },
};
export const classificationSchema: Schema<{ kind: 'invoice' | 'bank_change' | 'vendor' | 'unknown' }> = {
  jsonSchema: objectSchema({ kind: { enum: ['invoice', 'bank_change', 'vendor', 'unknown'] } }),
  parse(value) {
    const row = record(value, ['kind']);
    if (!['invoice', 'bank_change', 'vendor', 'unknown'].includes(String(row.kind))) throw new Error('INVALID_CLASSIFICATION');
    return { kind: row.kind as 'invoice' | 'bank_change' | 'vendor' | 'unknown' };
  },
};
export const sourceSchema = {
  parse(value: unknown): InboxSource {
    const row = record(value, ['id', 'source', 'senderDomain']);
    if (row.source !== 'seed' && row.source !== 'judge') throw new Error('INVALID_SOURCE');
    return { id: id(row.id), source: row.source, senderDomain: host(row.senderDomain) };
  },
};
