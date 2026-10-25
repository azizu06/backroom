'use client';
import { useState } from 'react';
import type { PolicyLimits } from '@backroom/orchestrator';
import type { Policy } from '../../policy/src/index';
import styles from '../app/policy/policy.module.css';

export function BadgeEditor({ policy, busy, onSave }: {
  policy: Policy; busy: boolean; onSave: (limits: PolicyLimits) => Promise<void>;
}) {
  const [fields, setFields] = useState({ maxInstallments: String(policy.badges.collections.limits.maxInstallments),
    minFirstPct: String(policy.badges.collections.limits.minFirstPct), maxPlanDays: String(policy.badges.collections.limits.maxPlanDays),
    maxPaymentCents: String(policy.badges.payables.maxPaymentCents) });
  function input(key: keyof PolicyLimits, label: string, min: number, max?: number, step = '1') {
    return <label>{label}<input type="number" required min={min} max={max} step={step} value={fields[key]}
      onChange={e => setFields({ ...fields, [key]: e.target.value })} /></label>;
  }
  function permissions(badge: keyof Policy['badges']) {
    const seat = policy.badges[badge];
    return <div className={styles.permissions}><p><strong>Rooms</strong> {seat.rooms.join(', ')}</p>
      <p><strong>Actions</strong> {seat.actions.map(action => action.replaceAll('_', ' ')).join(', ')}</p></div>;
  }
  return <form onSubmit={e => { e.preventDefault(); void onSave({ maxInstallments: Number(fields.maxInstallments), minFirstPct: Number(fields.minFirstPct), maxPlanDays: Number(fields.maxPlanDays), maxPaymentCents: Number(fields.maxPaymentCents) }); }}>
    <fieldset disabled={busy} className={styles.badges}>
      <legend>Seat Badges · v{policy.policyVersion}</legend>
      <section className={styles.badge} aria-labelledby="collections-title">
        <h2 id="collections-title">Collections</h2>
        <div className={styles.fields}>
          {input('maxInstallments', 'Maximum installments', 1, Number.MAX_SAFE_INTEGER)}
          {input('minFirstPct', 'Minimum first payment (%)', 0, 100, 'any')}
          {input('maxPlanDays', 'Maximum plan duration (days)', 0, Number.MAX_SAFE_INTEGER)}
        </div>
        <p>Fee waiver: {policy.badges.collections.limits.feesWaivable ? 'permitted' : 'not permitted'} · Maximum discount: {policy.badges.collections.limits.maxDiscountPct}%</p>
        {permissions('collections')}
      </section>
      <section className={styles.badge} aria-labelledby="payables-title">
        <h2 id="payables-title">Payables</h2>
        <div className={styles.fields}>{input('maxPaymentCents', 'Maximum payment (cents)', 1, Number.MAX_SAFE_INTEGER)}</div>
        <p>Saved limit: {(policy.badges.payables.maxPaymentCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · Operating account only</p>
        {permissions('payables')}
      </section>
      <section className={styles.badge} aria-labelledby="vendor-title">
        <h2 id="vendor-title">Vendor Onboarding</h2>
        <p>May propose vendors and bank changes. Cannot approve or execute a bank change.</p>
        {permissions('vendor_onboarding')}
      </section>
      <div className={styles.save}><button type="submit">{busy ? 'Saving…' : `Save as v${policy.policyVersion + 1}`}</button>
        <span>Creates a new version and records your change.</span></div>
    </fieldset>
  </form>;
}
