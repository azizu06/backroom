'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuditEntry, ChainStatus, WhyAnswer } from '@backroom/orchestrator';
import './AuditWall.css';

type Snapshot = { entries: AuditEntry[]; chain: ChainStatus; measuredAt: string };
const message = (error: unknown) => error instanceof Error ? error.message : 'Request failed. Try again.';
async function api(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/audit/${path}`, { cache: 'no-store', signal,
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? 'Request failed. Try again.'), { status: response.status });
  return data;
}
function recordedDecision(entry: AuditEntry) {
  const value = entry.inputs?.decision;
  if (!value || typeof value !== 'object') return;
  const quote = (value as { quote?: { sentenceId?: unknown; text?: unknown } }).quote;
  return quote && typeof quote.text === 'string' && typeof quote.sentenceId === 'string'
    ? { quote: { text: quote.text, sentenceId: quote.sentenceId } } : undefined;
}
function policyQuote(entry: AuditEntry, entries: AuditEntry[]) {
  const own = recordedDecision(entry)?.quote;
  if (own) return { ...own, source: entry.id };
  // Escalation lifecycle rows can reference the original evaluated gateway row.
  const linked = entries.find(row => entry.refs.includes(row.id) && row.policyVersion === entry.policyVersion
    && row.decision === entry.decision && entry.ruleIds.every(rule => row.ruleIds.includes(rule)) && recordedDecision(row));
  const quote = linked && recordedDecision(linked)?.quote;
  return quote && { ...quote, source: linked!.id };
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** A DOM panel: mount alongside the lobby canvas, or in a drei Html surface. */
export function AuditWall() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [locked, setLocked] = useState(false);
  const [code, setCode] = useState('');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<WhyAnswer>();
  const [asking, setAsking] = useState(false);
  const [whyError, setWhyError] = useState('');
  const replay = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next: Snapshot = await api('entries', undefined, controller.signal);
        setSnapshot(next); setLocked(false); setError('');
        setSelected(current => current ?? next.entries.at(-1)?.id);
      } catch (e) {
        if (controller.signal.aborted) return;
        if ((e as { status?: number }).status === 401) {
          setLocked(true); setSnapshot(undefined); setAnswer(undefined); return;
        }
        setError(message(e));
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 2000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);

  async function unlock(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('session', { code }); setCode(''); setLocked(false); setRevision(n => n + 1); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function ask(event: FormEvent) {
    event.preventDefault(); setAsking(true); setWhyError(''); setAnswer(undefined);
    try { setAnswer(await api('why', { question })); }
    catch (e) { setWhyError(message(e)); }
    finally { setAsking(false); }
  }
  function openEntry(id: string) {
    setSelected(id);
    requestAnimationFrame(() => replay.current?.focus());
  }
  const entries = snapshot?.entries ?? [];
  const entry = entries.find(row => row.id === selected);
  const quote = entry && policyQuote(entry, entries);
  const trusted = !!snapshot?.chain.valid && !error;
  function citation(id: string, key: number | string) {
    return entries.some(row => row.id === id)
      ? <a key={key} href="#audit-replay" onClick={() => openEntry(id)}>{id}</a>
      : <span key={key}>{id} (refresh to view)</span>;
  }

  return <section className="audit-wall" aria-labelledby="audit-title">
    <header className="audit-heading">
      <div><p className="audit-eyebrow">Northfield Studio / Decision record</p><h1 id="audit-title">Audit wall</h1>
        <p>Every action leaves a record. Follow the evidence.</p></div>
      {snapshot && <div className={`audit-chain ${!snapshot.chain.valid ? 'audit-broken' : error ? 'audit-stale' : 'audit-verified'}`} role="status">
        {!snapshot.chain.valid ? `Chain broken · first broken seq ${snapshot.chain.firstBrokenSeq}` : error ? 'Chain status stale' : `Chain verified · ${snapshot.chain.length} entries`}
      </div>}
    </header>
    {error && <p className="audit-error" role="alert">{error} <button type="button" onClick={() => setRevision(n => n + 1)}>Retry</button></p>}
    {locked ? <form className="audit-panel audit-unlock" onSubmit={unlock}>
      <h2>Open the decision record</h2><p>Use the private operator code provided with this demo.</p>
      <label>Operator code<input autoComplete="off" type="password" required value={code} onChange={e => setCode(e.target.value)} /></label>
      <button disabled={busy || !code}>{busy ? 'Opening…' : 'Open audit wall'}</button>
      <p className="audit-muted">Read access only. Approval decisions still require a passkey.</p>
    </form> : !snapshot ? <p role="status">Loading audit records…</p> : <>
      {!snapshot.chain.valid && <p className="audit-error" role="alert">The record has changed or a link is missing ({snapshot.chain.reason}). Treat these entries as untrusted. Ask why is paused.</p>}
      <div className="audit-workspace">
        <section className="audit-panel audit-records" aria-labelledby="audit-records-title">
          <div className="audit-section-heading"><h2 id="audit-records-title">Recorded actions</h2><span>{entries.length} total</span></div>
          <p className="audit-muted">Updates every 2 seconds · {new Date(snapshot.measuredAt).toLocaleTimeString()}</p>
          {!entries.length && <p>No actions recorded yet. Run the core loop in the connected server to see its decisions here.</p>}
          <ol className="audit-entries">{[...entries].reverse().map(row => {
            const quote = policyQuote(row, entries);
            return <li key={row.id}><button className="audit-entry" aria-pressed={selected === row.id} onClick={() => openEntry(row.id)}>
              <span className="audit-entry-top"><span className="audit-id">#{row.seq} · {row.id}</span><span className={`audit-outcome audit-${row.decision?.toLowerCase() ?? 'recorded'}`}>{row.decision ?? 'RECORDED'}</span></span>
              <strong>{row.action.replaceAll('_', ' ')}</strong>
              <span>{row.actor} · {row.seat.replaceAll('_', ' ')} · {new Date(row.ts).toLocaleTimeString()}</span>
              <span className="audit-rules">{row.ruleIds.join(' · ') || 'No rule recorded'} · policy v{row.policyVersion}</span>
              {(row.decision === 'DENY' || row.decision === 'ESCALATE') && <span className="audit-quote">{quote?.text ? `“${quote.text}” — ${quote.sentenceId}${quote.source !== row.id ? ` (via ${quote.source})` : ''}` : 'Policy sentence not recorded in this entry.'}</span>}
              <span className="audit-metrics">{row.route} · {row.latencyMs.toLocaleString()} ms · ${row.costUsd.toFixed(6)}</span>
            </button></li>;
          })}</ol>
        </section>
        <div className="audit-detail-column">
          <section className="audit-panel audit-replay" id="audit-replay" ref={replay} tabIndex={-1} aria-labelledby="audit-replay-title">
            <div className="audit-section-heading"><h2 id="audit-replay-title">{entry ? `Replay ${entry.id}` : 'Entry replay'}</h2><span>Read only</span></div>
            {entry ? <>
              <p className="audit-muted">Recorded inputs and evaluation. Replaying this view runs no actions.</p>
              <dl className="audit-facts"><div><dt>Actor / seat</dt><dd>{entry.actor} / {entry.seat}</dd></div>
                <div><dt>Action / outcome</dt><dd>{entry.action} / {entry.decision ?? 'No policy outcome recorded'}</dd></div>
                <div><dt>Route / model</dt><dd>{entry.route} / {typeof entry.inputs?.model === 'string' ? entry.inputs.model : 'No model recorded'}</dd></div>
                <div><dt>Latency / cost</dt><dd>{entry.latencyMs} ms / ${entry.costUsd.toFixed(6)}</dd></div></dl>
              <h3>Rule evaluation · policy v{entry.policyVersion}</h3><p className="audit-rules">{entry.ruleIds.join(', ') || 'No rules recorded'}</p>
              {quote && <blockquote>{quote.text}<cite>{quote.sentenceId}{quote.source !== entry.id && <> · recorded in {citation(quote.source, 'quote-source')}</>}</cite></blockquote>}
              <pre aria-label="Recorded rule evaluation">{pretty(entry.inputs?.decision ?? { outcome: entry.decision ?? null, ruleIds: entry.ruleIds })}</pre>
              <details open><summary>Recorded inputs</summary><pre>{pretty(entry.inputs ?? {})}</pre></details>
              <details><summary>Evidence and chain hashes</summary><pre>{pretty({ refs: entry.refs, seq: entry.seq, hash: entry.hash, prevHash: entry.prevHash })}</pre></details>
            </> : <p>Select an action to inspect its inputs, rules and outcome.</p>}
          </section>
          <section className="audit-panel audit-why" aria-labelledby="audit-why-title">
            <h2 id="audit-why-title">Ask why</h2><p className="audit-muted">Answers cite the recorded evidence. They cannot approve or pay.</p>
            <form onSubmit={ask}><label htmlFor="audit-question">Question about a decision</label>
              <textarea id="audit-question" rows={3} maxLength={1000} required placeholder="Why didn’t you pay invoice #4419?" value={question} onChange={e => setQuestion(e.target.value)} />
              <button disabled={asking || !question.trim() || !trusted}>{asking ? 'Reading the evidence…' : 'Explain decision'}</button>
            </form>
            {whyError && <p className="audit-error" role="alert">{whyError}</p>}
            {answer && <div className="audit-answer" aria-live="polite">
              <p className="audit-eyebrow">{answer.source === 'model' ? 'Model explanation · verified citations' : answer.source === 'fallback' ? 'Recorded facts · code fallback' : 'No matching evidence'}</p>
              <p>{answer.answer.split(/(\[entry:[A-Za-z0-9_.:-]+\])/g).map((part, i) => part.startsWith('[entry:') ? citation(part.slice(7, -1), i) : part)}</p>
              {!!answer.citations.length && <p className="audit-citations">Cited entries: {answer.citations.map(id => citation(id, id))}</p>}
              {!trusted && <p className="audit-error">This answer predates the current chain warning. Do not rely on it until the record is verified.</p>}
            </div>}
          </section>
        </div>
      </div>
      <footer className="audit-footer">This server’s audit snapshot · chain integrity checks detect changed entries and broken links.<br />The reference store is process-local. A verified chain alone cannot detect a removed suffix.</footer>
    </>}
  </section>;
}
