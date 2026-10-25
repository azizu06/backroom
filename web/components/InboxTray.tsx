'use client';

import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { InboxPreset, InboxReceipt } from '../lib/inbox/types';
import '../app/office/lobby.css';
import { crsFraudText } from '../lib/provenance';
import './InboxTray.css';

const seatName = { payables: 'Payables', vendor_onboarding: 'Vendor onboarding' };
/** Fields from the vision intake contract; optional until the server reports them. */
type TrayReceipt = InboxReceipt & { attachmentParsed?: boolean; documentRoute?: 'local' | 'cloud_fallback' | null };
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const attachmentTypes: Record<string, string> = {
  'application/pdf': 'PDF', 'image/png': 'PNG image', 'image/jpeg': 'JPEG image', 'image/webp': 'WebP image',
};

function formatSize(bytes: number, round: (value: number) => number = Math.round) {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${Math.min(1023, round(bytes / 1024))} KB`;
  return `${(round(bytes / 1024 / 1024 * 10) / 10).toFixed(1)} MB`;
}

/** The receipt shows only the first sentence of the reason; the full text and policy quote sit under Full receipt. */
function firstSentence(text: string) {
  return text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
}

function attachmentProblem(file: File) {
  if (!Object.hasOwn(attachmentTypes, file.type)) return `${file.name} is not a PDF, PNG, JPEG or WebP.`;
  if (file.size <= 0) return `${file.name} is empty.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is ${formatSize(file.size, Math.ceil)}. The limit is 4 MB.`;
  return '';
}

/** DOM panel for /inbox and the office lobby; presets are serializable server-owned fixture text. */
/** headingLevel 3 when embedded under another page heading (the office lobby); 1 on /inbox. */
export function InboxTray({ presets = [], headingLevel = 1 }: { presets?: InboxPreset[]; headingLevel?: 1 | 3 }) {
  const Title = headingLevel === 3 ? 'h3' : 'h1';
  const Sub = headingLevel === 3 ? 'h4' : 'h2';
  const uid = useId();
  const [presetId, setPresetId] = useState('');
  const [kind, setKind] = useState('email');
  const [sender, setSender] = useState('');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<File>();
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<TrayReceipt>();
  const fileInput = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLElement>(null);
  function clearAttachment() {
    setAttachment(undefined); setFileError('');
    if (fileInput.current) fileInput.current.value = '';
  }
  function accept(files: FileList | null | undefined, dropped: FileList | null = null) {
    if (!files?.length && !dropped) { clearAttachment(); return; }
    const file = files?.length === 1 ? files[0] : undefined;
    const problem = file ? attachmentProblem(file) : 'Drop one file at a time.';
    if (!file || problem) {
      setAttachment(undefined); setFileError(problem);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setAttachment(file); setFileError('');
    if (dropped && fileInput.current) {
      try { fileInput.current.files = dropped; } catch { fileInput.current.value = ''; }
    }
  }
  // A near-miss drop outside the zone must not navigate away and lose the typed scenario.
  useEffect(() => {
    const guard = (event: globalThis.DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', guard); window.addEventListener('drop', guard);
    return () => { window.removeEventListener('dragover', guard); window.removeEventListener('drop', guard); };
  }, []);
  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (busy) { event.dataTransfer.dropEffect = 'none'; return; }
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }
  function dragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDragging(false);
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy || !event.dataTransfer.files.length) return;
    accept(event.dataTransfer.files, event.dataTransfer.files);
  }
  function removeAttachment() {
    clearAttachment();
    fileInput.current?.focus();
  }
  async function route(input: { presetId: string; kind: string; senderDomain: string; text: string; attachment?: File }) {
    if (busy) return;
    setBusy(true); setPresetId(input.presetId); setReceipt(undefined); setError('');
    const form = new FormData();
    form.set('kind', input.kind); form.set('senderDomain', input.senderDomain); form.set('text', input.text); form.set('presetId', input.presetId);
    if (input.attachment) form.set('attachment', input.attachment);
    try {
      const response = await fetch('/api/inbox', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Intake is unavailable. Try again.');
      setReceipt(body);
      requestAnimationFrame(() => result.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Intake is unavailable. Try again.'); }
    finally { setBusy(false); }
  }
  // A planted card sends the exact fixture text, so the server matches it to frozen seed fields.
  function runPreset(preset: InboxPreset) {
    route({ presetId: preset.id, kind: preset.kind, senderDomain: preset.senderDomain, text: preset.text });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    route({ presetId: '', kind, senderDomain: sender, text, attachment });
  }
  const field = receipt?.fields;
  const quote = receipt && 'quote' in receipt.decision ? receipt.decision.quote : undefined;
  const reason = receipt && 'reason' in receipt.decision ? receipt.decision.reason : undefined;
  const held = receipt?.status === 'held' || receipt?.decision.kind === 'ESCALATE';
  const why = reason ? firstSentence(reason) : quote?.text ?? (receipt?.decision.kind === 'ALLOW' ? 'Every check passed.' : receipt?.notice);
  const fraudText = receipt?.bankChangeFraud && crsFraudText(receipt.bankChangeFraud);
  const fileHelp = `${uid}-file-help`, fileErrorId = `${uid}-file-error`;
  return <section className="inbox-tray" aria-labelledby={`${uid}-title`}>
    <header className="inbox-heading">
      <Title id={`${uid}-title`} className="inbox-title">Inbox</Title>
      <p>Vendor bills and emails land here. Code checks every one before anything gets paid.</p>
    </header>
    <div className="inbox-presets" role="group" aria-label="Planted scenarios">
      {presets.map(preset => <button key={preset.id} type="button" className="inbox-card" disabled={busy}
        aria-pressed={presetId === preset.id} onClick={() => runPreset(preset)}>
        <strong>{preset.label}</strong>
        <span>{preset.kind === 'invoice' ? `Invoice #${preset.id}` : 'Bank change email'}</span>
      </button>)}
    </div>
    <section className="inbox-result" aria-labelledby={`${uid}-decision`} aria-live="polite" aria-busy={busy} ref={result} tabIndex={-1}>
      <Sub id={`${uid}-decision`}>Decision receipt</Sub>
      {error && <p className="inbox-error" role="alert">{error}</p>}
      {!receipt ? <p className="inbox-empty">{busy ? 'Checking…' : 'Pick a scenario above to see who handles it and why.'}</p> : <>
        <div className="inbox-outcome" data-decision={receipt.decision.kind}><strong>{receipt.decision.kind}</strong><span>{receipt.status.replaceAll('_', ' ')}</span></div>
        <dl className="inbox-facts">
          <div><dt>Seat</dt><dd>{seatName[receipt.seat]}</dd></div>
          <div><dt>Rule</dt><dd>{receipt.decision.ruleIds.join(', ') || 'None tripped'}</dd></div>
          {fraudText && <div><dt>CRS fraud score</dt><dd>{fraudText}</dd></div>}
          <div><dt>Why</dt><dd>{why}</dd></div>
        </dl>
        <p className="inbox-links">
          <a href={receipt.auditHref}>Audit story {receipt.auditId} →</a>
          {receipt.escalationId && (receipt.approvalHref
            ? <a href={receipt.approvalHref}>Open Dana’s approval card →</a> : <span>Controller review requested.</span>)}
        </p>
        <details className="inbox-more">
          <summary>Full receipt</summary>
          <dl className="inbox-facts">
            <div><dt>Scenario source</dt><dd>Custom</dd></div>
            <div><dt>Extraction</dt><dd>{receipt.extractionSource === 'seed' ? 'Frozen seed fields · code' : receipt.extractionSource === 'model' ? 'Model fields · schema validated' : 'Unrecognized · human review'}</dd></div>
            {receipt.paymentRail && <div><dt>Payment rail</dt><dd>{receipt.paymentRail === 'nessie' ? 'Nessie' : receipt.paymentRail}</dd></div>}
            {receipt.receiptId && <div><dt>Bank debit</dt><dd>{receipt.receiptId}</dd></div>}
            {receipt.reconciliation && <div><dt>Reconciliation</dt><dd>{receipt.reconciliation.match === 'EXACT' ? 'Exact withdrawal match' : 'Mismatch · held for review'}</dd></div>}
          </dl>
          {(held || reason) && <>
            <Sub className="inbox-minor">{held ? 'Hold reasons' : 'Reasons'}</Sub>
            <ul className="inbox-reasons">
              {reason && <li>{reason}</li>}
              {receipt.attachment && receipt.attachmentParsed === false &&
                <li>The document could not be read into validated fields (missing facts, model offline or render failure).</li>}
            </ul>
          </>}
          {quote ? <blockquote>“{quote.text}”<cite>Policy v{receipt.decision.policyVersion} · {quote.sentenceId}</cite></blockquote>
            : <p>No restrictive policy sentence was recorded.</p>}
          <Sub className="inbox-minor">Extracted fields</Sub>
          {field ? <dl className="inbox-facts">
            <div><dt>Vendor</dt><dd>{field.vendorId}</dd></div>
            {field.kind === 'invoice' ? <>
              <div><dt>Invoice</dt><dd>#{field.invoiceId}</dd></div>
              <div><dt>Amount</dt><dd>{new Intl.NumberFormat('en-US', { style: 'currency', currency: field.currency }).format(field.amountCents / 100)}</dd></div>
              <div><dt>Purchase order</dt><dd>{field.poId ?? 'None'}</dd></div>
            </> : <div><dt>Domain</dt><dd>{field.domain}</dd></div>}
            <div><dt>Requested account</dt><dd>{field.bankAccountId}</dd></div>
          </dl> : <p>No validated fields. The input stays held.</p>}
          {receipt.attachment && <>
            <Sub className="inbox-minor">Document</Sub>
            <dl className="inbox-facts">
              <div><dt>Attachment</dt><dd>{receipt.attachment.name} · {formatSize(receipt.attachment.size)}</dd></div>
              <div><dt>Read by</dt><dd>{receipt.documentRoute === 'local' ? 'Read locally on GX10'
                : receipt.documentRoute === 'cloud_fallback' ? 'Cloud fallback'
                : receipt.documentRoute === null ? 'No accepted extraction' : 'Not reported'}</dd></div>
              <div><dt>Parsed</dt><dd>{receipt.attachmentParsed === true ? 'Fields extracted'
                : receipt.attachmentParsed === false ? held ? 'Not parsed · held' : 'Not parsed' : 'Not reported'}</dd></div>
            </dl>
            {receipt.documentRoute === 'cloud_fallback' &&
              <p className="inbox-help">The GX10 read failed schema validation twice, so a cloud model read this document instead.</p>}
          </>}
          <p className="inbox-help">{receipt.notice}{receipt.escalationId ? ' This page cannot approve or change a bank account.' : ''}</p>
        </details>
      </>}
    </section>
    <details className="inbox-advanced">
      <summary>Advanced: try your own email</summary>
      <form onSubmit={submit} aria-label="Custom scenario">
        <fieldset disabled={busy}>
          <div className="inbox-envelope">
            <div><label htmlFor={`${uid}-kind`}>Document type</label><select id={`${uid}-kind`} value={kind} onChange={event => setKind(event.target.value)}>
              <option value="email">Email</option><option value="invoice">Invoice</option>
            </select></div>
            <div><label htmlFor={`${uid}-sender`}>Sender domain</label><input id={`${uid}-sender`} placeholder="vendor.example" value={sender}
              maxLength={253} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={event => setSender(event.target.value)} aria-describedby={`${uid}-sender-help`} /></div>
          </div>
          <p id={`${uid}-sender-help`} className="inbox-help">A missing or unknown sender goes to human review.</p>
          <label htmlFor={`${uid}-text`}>Email or invoice text</label>
          <textarea id={`${uid}-text`} rows={6} maxLength={32000} value={text} onChange={event => setText(event.target.value)}
            placeholder="Try a bank change, an invoice with no PO, or something we have never seen…" />
          <div className="inbox-dropzone" data-dragging={dragging ? 'true' : undefined}
            onDragEnter={dragOver} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop}>
            <label htmlFor={`${uid}-file`}>Attach a PDF or image <span>(optional)</span></label>
            <p className="inbox-dropzone-copy">{dragging ? 'Release to attach' : 'Drag a file here or choose one'}</p>
            <input id={`${uid}-file`} ref={fileInput} type="file" accept={Object.keys(attachmentTypes).join(',')}
              onChange={event => accept(event.target.files)} aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? `${fileErrorId} ${fileHelp}` : fileHelp} />
            {fileError && <p id={fileErrorId} className="inbox-error inbox-file-error" role="alert">{fileError}</p>}
            {attachment && <div className="inbox-preview">
              <p><strong>{attachment.name}</strong><span>{formatSize(attachment.size)} · {attachmentTypes[attachment.type]}</span></p>
              <button type="button" className="inbox-remove" onClick={removeAttachment}>Remove attachment</button>
            </div>}
          </div>
          <p id={fileHelp} className="inbox-help">PDF, PNG, JPEG or WebP, up to 4 MB; PDFs up to 4 pages. A file that cannot be read into validated facts is held for human review.</p>
          <button className="inbox-submit" disabled={busy || (!text.trim() && !attachment)}>{busy ? 'Checking…' : 'Route scenario'}</button>
        </fieldset>
      </form>
    </details>
  </section>;
}
