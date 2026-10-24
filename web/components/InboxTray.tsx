'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import type { InboxPreset, InboxReceipt } from '../lib/inbox/types';
import './InboxTray.css';

const seatName = { payables: 'Payables', vendor_onboarding: 'Vendor onboarding' };

/** DOM panel for the lobby; presets are serializable server-owned fixture text. */
/** headingLevel 3 when embedded under another page heading (the office lobby); 1 on /inbox. */
export function InboxTray({ presets = [], headingLevel = 1 }: { presets?: InboxPreset[]; headingLevel?: 1 | 3 }) {
  const Title = headingLevel === 3 ? "h3" : "h1";
  const uid = useId();
  const [presetId, setPresetId] = useState('');
  const [kind, setKind] = useState('email');
  const [sender, setSender] = useState('');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<InboxReceipt>();
  const fileInput = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLElement>(null);
  function choose(id: string) {
    setPresetId(id); setReceipt(undefined); setError(''); setAttachment(undefined);
    if (fileInput.current) fileInput.current.value = '';
    const preset = presets.find(row => row.id === id);
    setKind(preset?.kind ?? 'email'); setSender(preset?.senderDomain ?? ''); setText(preset?.text ?? '');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setReceipt(undefined); setError('');
    const form = new FormData();
    form.set('kind', kind); form.set('senderDomain', sender); form.set('text', text); form.set('presetId', presetId);
    if (attachment) form.set('attachment', attachment);
    try {
      const response = await fetch('/api/inbox', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Intake is unavailable. Try again.');
      setReceipt(body);
      requestAnimationFrame(() => result.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Intake is unavailable. Try again.'); }
    finally { setBusy(false); }
  }
  const field = receipt?.fields;
  const quote = receipt && 'quote' in receipt.decision ? receipt.decision.quote : undefined;
  return <section className="inbox-tray" aria-labelledby={`${uid}-title`}>
    <header className="inbox-heading">
      <div><Title id={`${uid}-title`} className="inbox-title">Inbox tray</Title><p>Give Northfield an email or invoice. See which seat handles it and why.</p></div>
      <a href="/audit">Audit wall →</a>
    </header>
    <div className="inbox-workspace">
      <form onSubmit={submit} className="inbox-document" aria-label="Judge scenario">
        <h2>Your scenario</h2>
        <fieldset disabled={busy}>
          <label htmlFor={`${uid}-preset`}>Start with a planted scenario</label>
          <select id={`${uid}-preset`} value={presetId} onChange={event => choose(event.target.value)}>
            <option value="">Write my own scenario</option>
            {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
          <div className="inbox-envelope">
            <div><label htmlFor={`${uid}-kind`}>Document type</label><select id={`${uid}-kind`} value={kind} onChange={event => setKind(event.target.value)}>
              <option value="email">Email</option><option value="invoice">Invoice</option>
            </select></div>
            <div><label htmlFor={`${uid}-sender`}>Sender domain</label><input id={`${uid}-sender`} placeholder="vendor.example" value={sender}
              maxLength={253} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={event => setSender(event.target.value)} aria-describedby={`${uid}-sender-help`} /></div>
          </div>
          <p id={`${uid}-sender-help`} className="inbox-help">Demo envelope metadata, entered by you. A missing or unknown sender goes to human review.</p>
          <label htmlFor={`${uid}-text`}>Email, invoice, or your own scenario</label>
          <textarea id={`${uid}-text`} rows={13} maxLength={32000} value={text} onChange={event => setText(event.target.value)}
            placeholder="Try a bank change, an invoice with no PO, or something we have never seen…" />
          <label htmlFor={`${uid}-file`}>Attach a PDF or image <span>(optional)</span></label>
          <input id={`${uid}-file`} ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={event => setAttachment(event.target.files?.[0])} aria-describedby={`${uid}-file-help`} />
          <p id={`${uid}-file-help`} className="inbox-help">Up to 4 MB. Attachments are held for human review. Only their fingerprint is recorded; paste text above to test extraction.</p>
          {attachment && <button type="button" className="inbox-remove" onClick={() => { setAttachment(undefined); if (fileInput.current) fileInput.current.value = ''; }}>Remove attachment</button>}
          <button className="inbox-submit" disabled={busy || (!text.trim() && !attachment)}>{busy ? 'Reviewing scenario…' : 'Route scenario'}</button>
        </fieldset>
        <p className="inbox-help">Synthetic company and vendors. No bank debit. Unrecognized input is held for Dana.</p>
        {error && <p className="inbox-error" role="alert">{error}</p>}
      </form>
      <section className="inbox-result" aria-labelledby={`${uid}-decision`} aria-live="polite" aria-busy={busy} ref={result} tabIndex={-1}>
        <h2 id={`${uid}-decision`}>Decision receipt</h2>
        {!receipt ? <div className="inbox-empty"><p>{busy ? 'Routing and checking the scenario…' : 'Route a scenario to see its decision.'}</p>
          <p>Policy rules decide. New or unclear instructions default to ESCALATE.</p></div> : <>
          <div className="inbox-outcome" data-decision={receipt.decision.kind}><strong>{receipt.decision.kind}</strong><span>{receipt.status.replaceAll('_', ' ')}</span></div>
          <dl className="inbox-facts">
            <div><dt>Routed seat</dt><dd>{seatName[receipt.seat]}</dd></div>
            <div><dt>Scenario source</dt><dd>judge</dd></div>
            <div><dt>Extraction</dt><dd>{receipt.extractionSource === 'seed' ? 'Frozen seed fields · code' : receipt.extractionSource === 'model' ? 'Model fields · schema validated' : 'Unrecognized · human review'}</dd></div>
            <div><dt>Rules</dt><dd>{receipt.decision.ruleIds.join(', ')}</dd></div>
          </dl>
          {quote ? <blockquote>“{quote.text}”<cite>Policy v{receipt.decision.policyVersion} · {quote.sentenceId}</cite></blockquote>
            : <p>No restrictive policy sentence was recorded.</p>}
          <h3>Extracted fields</h3>
          {field ? <dl className="inbox-facts">
            <div><dt>Vendor</dt><dd>{field.vendorId}</dd></div>
            {field.kind === 'invoice' ? <>
              <div><dt>Invoice</dt><dd>#{field.invoiceId}</dd></div>
              <div><dt>Amount</dt><dd>{new Intl.NumberFormat('en-US', { style: 'currency', currency: field.currency }).format(field.amountCents / 100)}</dd></div>
              <div><dt>Purchase order</dt><dd>{field.poId ?? 'None'}</dd></div>
            </> : <div><dt>Domain</dt><dd>{field.domain}</dd></div>}
            <div><dt>Requested account</dt><dd>{field.bankAccountId}</dd></div>
          </dl> : <p>No validated fields. The input stays held.</p>}
          {field && <details><summary>All validated fields</summary><pre>{JSON.stringify(field, null, 2)}</pre></details>}
          {receipt.attachment && <p className="inbox-help">Attachment: {receipt.attachment.name} · {receipt.attachment.size.toLocaleString()} bytes</p>}
          <p className="inbox-notice">{receipt.notice}</p>
          <a className="inbox-audit-link" href={receipt.auditHref}>View audit entry {receipt.auditId} →</a>
          {receipt.escalationId && <p className="inbox-help">Controller review requested. This form cannot approve or change a bank account.</p>}
        </>}
      </section>
    </div>
  </section>;
}
