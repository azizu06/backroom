'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuditEntry, ChainStatus, WhyAnswer } from '@backroom/orchestrator';
import { auditUnlockMessage, CODE_REJECTED, ORIGIN_REJECTED } from '../lib/audit/session-message';
import { jsonObject, NETWORK_MESSAGE, outageMessage, serverError } from '../lib/http/response';
import { signInOperator } from '../lib/operator/sign-in-client';
import { auditStories, whyQuestion, type StoryLine } from '../lib/audit/stories';
import './AuditWall.css';

export type AuditSnapshot = { entries: AuditEntry[]; chain: ChainStatus; measuredAt: string };
const message = (error: unknown) => error instanceof Error ? error.message : 'Request failed. Try again.';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers read route-specific shapes, as before
async function api(path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`/api/audit/${path}`, { cache: 'no-store', signal,
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(NETWORK_MESSAGE);
  }
  const data = await jsonObject(response);
  const status = response.status;
  if (!data) throw Object.assign(new Error(outageMessage(status)), { status });
  if (!response.ok) throw Object.assign(new Error(serverError(data) ?? 'Request failed. Try again.'), { status });
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
const PROOF = { passkey: 'Human passkey', deny: 'Policy DENY', match: 'Exact match' } as const;

/** A DOM panel: mount alongside the lobby canvas, or in a drei Html surface. */
export function AuditWall({ recording, onChainChange, showAsk = true, headingLevel = 1, originRejected = ORIGIN_REJECTED, codeRejected = CODE_REJECTED }: {
  recording?: AuditSnapshot;
  onChainChange?: (valid: boolean) => void;
  showAsk?: boolean;
  headingLevel?: 1 | 2 | 3;
  /** Unlock copy. A refused page and a refused code stay different sentences. */
  originRejected?: string;
  codeRejected?: string;
} = {}) {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  const PanelHeading = `h${headingLevel + 1}` as 'h2' | 'h3' | 'h4';
  const DetailHeading = `h${headingLevel + 2}` as 'h3' | 'h4' | 'h5';
  const [liveSnapshot, setSnapshot] = useState<AuditSnapshot>();
  const snapshot = recording ?? liveSnapshot;
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
  const [advanced, setAdvanced] = useState(false);
  const replay = useRef<HTMLElement>(null);
  const why = useRef<HTMLElement>(null);
  const linked = useRef(false);

  useEffect(() => {
    if (recording) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const session = await api('session', undefined, controller.signal);
        if (!session.signedIn) { setLocked(true); setSnapshot(undefined); setAnswer(undefined); return; }
        const next: AuditSnapshot = await api('entries', undefined, controller.signal);
        setSnapshot(next); setLocked(false); setError('');
        const requested = new URLSearchParams(window.location.search).get('entry');
        // A linked entry (inbox receipt, operator proof) opens the full record at that row.
        if (requested && !linked.current) { linked.current = true; setAdvanced(true); }
        setSelected(current => current ?? (requested || next.entries.at(-1)?.id));
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
  }, [revision, recording]);

  useEffect(() => {
    if (snapshot) onChainChange?.(snapshot.chain.valid);
  }, [snapshot?.chain.valid, onChainChange]);

  async function unlock(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await signInOperator(code); setCode(''); setLocked(false); setRevision(n => n + 1); }
    catch (e) { setError(auditUnlockMessage(message(e), { origin: originRejected, code: codeRejected })); }
    finally { setBusy(false); }
  }
  async function explain(text: string) {
    setAsking(true); setWhyError(''); setAnswer(undefined);
    try { setAnswer(await api('why', { question: text })); }
    catch (e) { setWhyError(message(e)); }
    finally { setAsking(false); }
  }
  function ask(event: FormEvent) {
    event.preventDefault(); void explain(question);
  }
  function askAbout(row: AuditEntry) {
    const text = whyQuestion(row);
    setQuestion(text); void explain(text);
    why.current?.scrollIntoView({ block: 'nearest' });
  }
  function openEntry(id: string) {
    setSelected(id); setAdvanced(true);
    requestAnimationFrame(() => replay.current?.focus());
  }
  const entries = snapshot?.entries ?? [];
  const entry = entries.find(row => row.id === selected) ?? (recording ? entries.at(-1) : undefined);
  const quote = entry && policyQuote(entry, entries);
  const trusted = !!snapshot?.chain.valid && !error;
  const stories = auditStories(entries);
  const canAsk = !recording && showAsk;
  function citation(id: string, key: number | string) {
    return entries.some(row => row.id === id)
      ? <a key={key} href="#audit-replay" onClick={() => openEntry(id)}>{id}</a>
      : <span key={key}>{id} (refresh to view)</span>;
  }

  /** `quoted` keeps one policy sentence per story: the second escalation row cites it, it does not repeat it. */
  function storyLine(line: StoryLine, quoted: Set<string>) {
    const row = line.entry;
    const quote = (line.outcome === 'DENY' || line.outcome === 'ESCALATE') ? policyQuote(row, entries) : undefined;
    const fresh = quote && !quoted.has(quote.sentenceId);
    if (quote) quoted.add(quote.sentenceId);
    return <li key={row.id} className="audit-line" data-proof={line.proof}>
      <button type="button" className="audit-line-main" onClick={() => openEntry(row.id)}>
        <span className="audit-line-top"><span className="audit-who">{line.who}</span><span className="audit-text">{line.text}</span>
          {line.outcome && <span className={`audit-outcome audit-${line.outcome.toLowerCase()}`}>{line.outcome}</span>}</span>
        {(line.rule || line.amount || line.proof) && <span className="audit-line-meta">
          {line.proof && <span className="audit-proof">{PROOF[line.proof]}</span>}
          {line.rule && <span className="audit-rules">{line.rule}{quote ? ` · ${quote.sentenceId}` : ''}</span>}
          {line.amount && <span className="audit-amount">{line.amount}</span>}</span>}
        {fresh && <span className="audit-quote">“{quote.text}”</span>}
      </button>
      {canAsk && (row.decision || line.proof) && <button type="button" className="audit-ask-row" disabled={asking || !trusted}
        aria-label={`Ask why: ${line.text}`} onClick={() => askAbout(row)}>Ask why</button>}
    </li>;
  }

  return <section className="audit-wall" aria-labelledby="audit-title">
    <header className="audit-heading">
      <div><Heading id="audit-title">Audit wall</Heading>
        <p>{recording ? 'REPLAY · original recorded entries. No actions run.' : 'Every decision in this run: who decided, under which rule, and the outcome.'}</p></div>
      {snapshot && <div className={`audit-chain ${!snapshot.chain.valid ? 'audit-broken' : error ? 'audit-stale' : 'audit-verified'}`} role="status">
        {!snapshot.chain.valid ? `Chain broken · first broken seq ${snapshot.chain.firstBrokenSeq}` : error ? 'Chain status stale' : `${recording ? 'Recorded chain verified' : 'Chain verified'} · ${snapshot.chain.length} entries`}
      </div>}
    </header>
    {error && <p className="audit-error" role="alert">{error} <button type="button" onClick={() => setRevision(n => n + 1)}>Retry</button></p>}
    {locked ? <form className="audit-panel audit-unlock" onSubmit={unlock}>
      <PanelHeading>Open the decision record</PanelHeading><p>Enter the operator code to open this run’s decisions.</p>
      <label>Operator code<input autoComplete="off" type="password" required value={code} onChange={e => setCode(e.target.value)} /></label>
      <button disabled={busy || !code}>{busy ? 'Opening…' : 'Open audit wall'}</button>
      <p className="audit-muted">Read access only. Approval decisions still require a passkey.</p>
    </form> : !snapshot ? <p role="status">Loading audit records…</p> : <>
      {!snapshot.chain.valid && <p className="audit-error" role="alert">The record has changed or a link is missing ({snapshot.chain.reason}). Treat these entries as untrusted. Ask why is paused.</p>}
      <div className={`audit-layout${canAsk ? '' : ' audit-layout-single'}`}>
        <section className="audit-stories" aria-label="This run">
          {!stories.length && <p className="audit-panel">No decisions in this run yet. Request a call from the office Collections desk to see them here.</p>}
          <ol>{stories.map(story => <li key={story.id} className="audit-panel audit-story" data-kind={story.kind}>
            <div className="audit-section-heading"><PanelHeading>{story.title}</PanelHeading>
              <span>{story.total} {story.total === 1 ? 'entry' : 'entries'}</span></div>
            <ul className="audit-lines">{(quoted => story.lines.map(line => storyLine(line, quoted)))(new Set<string>())}</ul>
            {story.total > story.lines.length && <button type="button" className="audit-more" onClick={() => { setAdvanced(true); requestAnimationFrame(() => replay.current?.scrollIntoView({ block: 'start' })); }}>
              {story.total - story.lines.length} more in all entries</button>}
          </li>)}</ol>
        </section>
        {canAsk && <section className="audit-panel audit-why" ref={why} aria-labelledby="audit-why-title">
          <PanelHeading id="audit-why-title">Ask why</PanelHeading><p className="audit-muted">Answers cite the recorded evidence. They cannot approve or pay.</p>
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
        </section>}
      </div>
      <details className="audit-advanced" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
        <summary>Show all entries · {entries.length} recorded, with raw inputs and chain hashes</summary>
        <div className="audit-workspace">
          <section className="audit-panel audit-records" aria-labelledby="audit-records-title">
            <div className="audit-section-heading"><PanelHeading id="audit-records-title">Recorded actions</PanelHeading><span>{entries.length} total</span></div>
            <p className="audit-muted">{recording ? 'REPLAY position' : 'Updates every 2 seconds'} · {new Date(snapshot.measuredAt).toLocaleTimeString()}</p>
            {!entries.length && <p>No actions recorded yet. Request a call from the office to see decisions here.</p>}
            <ol className="audit-entries">{[...entries].reverse().map(row => {
              const quote = policyQuote(row, entries);
              return <li key={row.id} data-audit-id={row.id}><button className="audit-entry" aria-pressed={selected === row.id} onClick={() => openEntry(row.id)}>
                <span className="audit-entry-top"><span className="audit-id">#{row.seq} · {row.id}</span><span className={`audit-outcome audit-${row.decision?.toLowerCase() ?? 'recorded'}`}>{row.decision ?? 'RECORDED'}</span></span>
                <strong>{row.action.replaceAll('_', ' ')}</strong>
                <span>{row.actor} · {row.seat.replaceAll('_', ' ')} · {new Date(row.ts).toLocaleTimeString()}</span>
                <span className="audit-rules">{row.ruleIds.join(' · ') || 'No rule recorded'} · policy v{row.policyVersion}</span>
                {(row.decision === 'DENY' || row.decision === 'ESCALATE') && <span className="audit-quote">{quote?.text ? `“${quote.text}” — ${quote.sentenceId}${quote.source !== row.id ? ` (via ${quote.source})` : ''}` : 'Policy sentence not recorded in this entry.'}</span>}
                <span className="audit-metrics">{row.route} · {row.latencyMs.toLocaleString()} ms · ${row.costUsd.toFixed(6)}</span>
              </button></li>;
            })}</ol>
          </section>
          <section className="audit-panel audit-replay" id="audit-replay" ref={replay} tabIndex={-1} aria-labelledby="audit-replay-title">
            <div className="audit-section-heading"><PanelHeading id="audit-replay-title">{entry ? `Replay ${entry.id}` : 'Entry replay'}</PanelHeading><span>Read only</span></div>
            {entry ? <>
              <p className="audit-muted">Recorded inputs and evaluation. Replaying this view runs no actions.</p>
              <dl className="audit-facts"><div><dt>Actor / seat</dt><dd>{entry.actor} / {entry.seat}</dd></div>
                <div><dt>Action / outcome</dt><dd>{entry.action} / {entry.decision ?? 'No policy outcome recorded'}</dd></div>
                <div><dt>Route / model</dt><dd>{entry.route} / {typeof entry.inputs?.model === 'string' ? entry.inputs.model : 'No model recorded'}</dd></div>
                <div><dt>Latency / cost</dt><dd>{entry.latencyMs} ms / ${entry.costUsd.toFixed(6)}</dd></div></dl>
              <DetailHeading>Rule evaluation · policy v{entry.policyVersion}</DetailHeading><p className="audit-rules">{entry.ruleIds.join(', ') || 'No rules recorded'}</p>
              {quote && <blockquote>{quote.text}<cite>{quote.sentenceId}{quote.source !== entry.id && <> · recorded in {citation(quote.source, 'quote-source')}</>}</cite></blockquote>}
              <pre aria-label="Recorded rule evaluation">{pretty(entry.inputs?.decision ?? { outcome: entry.decision ?? null, ruleIds: entry.ruleIds })}</pre>
              <details open><summary>Recorded inputs</summary><pre>{pretty(entry.inputs ?? {})}</pre></details>
              <details><summary>Evidence and chain hashes</summary><pre>{pretty({ refs: entry.refs, seq: entry.seq, hash: entry.hash, prevHash: entry.prevHash })}</pre></details>
            </> : <p>Select an action to inspect its inputs, rules and outcome.</p>}
          </section>
        </div>
        <p className="audit-footer">{recording ? 'REPLAY · saved audit chain. No live polling, model calls or effects.' : 'Chain checks flag edited entries and broken links.'}</p>
      </details>
    </>}
  </section>;
}
