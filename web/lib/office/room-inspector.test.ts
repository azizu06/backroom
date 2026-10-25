import * as React from 'react';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { RoomInspector } from '../../app/office/RoomInspector';
import { INITIAL_OFFICE } from './state';
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server');
Object.assign(globalThis, { React });
describe('room inspector display', () => {
  it('renders friendly subscribed limits and actions without JSON', () => {
    const html = renderToStaticMarkup(React.createElement(RoomInspector, { room: 'payables', close() {}, snapshot: {
      ...INITIAL_OFFICE, badges: [{ seatId: 'payables', policyVersion: 1, rooms: ['payables'], actions: ['pay_invoice'],
        limits: { maxPaymentCents: 200000, minFirstPct: 50, feesWaivable: false, other: { maxPlanDays: 30 } } }],
    } }));
    expect(html).toContain('<dt>Maximum payment</dt><dd>$2,000.00</dd>');
    expect(html).toContain('<dt>Minimum first payment</dt><dd>50%</dd>');
    expect(html).toContain('<dt>Fees waivable</dt><dd>no</dd>');
    expect(html).toContain('<li>Pay invoice</li>');
    expect(html).not.toMatch(/maxPaymentCents|200000|pay_invoice|\{&quot;/);
  });
});
