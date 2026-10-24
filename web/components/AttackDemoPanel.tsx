'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { attackErrorMessage } from '../lib/attack-demo/errors';
import { parseAttackPresets, parseAttackResult, record, type AttackMode, type AttackPresets, type AttackResult } from '../lib/attack-demo/response';
import './AttackDemoPanel.css';

const LIVE_HELP = 'Live allows one Haiku activation per service instance, capped at $0.02. The server enforces the global OFF switch. No money moves.';
const BLOCKED_HELP = 'Live is disabled by the demo server. Runs use Mock.';

/** Displays server evidence only. No policy decisions or fabricated offline trace. */
export function AttackDemoPanel() {
  const id = useId();
  const [presets, setPresets] = useState<AttackPresets | null>(null);
  const [presetError, setPresetError] = useState('');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string>();
  const [mode, setMode] = useState<AttackMode>('mock');
  const [liveBlocked, setLiveBlocked] = useState<boolean | undefined>();
  const [result, setResult] = useState<AttackResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    async function load() {
      try {
        const response = await fetch('/api/attack-demo', { cache: 'no-store', signal: controller.signal });
        const value: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) {
          if (!disposed) setPresetError(attackErrorMessage('ATTACK_TIMEOUT'));
          return;
        }
        if (!response.ok) {
          if (!controller.signal.aborted) setPresetError(attackErrorMessage(record(value) ? value.error : undefined, response.status));
          return;
        }
        const data = parseAttackPresets(value);
        if (!controller.signal.aborted) {
          if (!data) setPresetError(attackErrorMessage('ATTACK_BAD_RESPONSE'));
          else { setPresets(data); setLiveBlocked(data.liveBlocked === true); }
        }
      } catch {
        if (!disposed) setPresetError(attackErrorMessage(controller.signal.aborted ? 'ATTACK_TIMEOUT' : 'NETWORK_ERROR'));
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { disposed = true; mounted.current = false; clearTimeout(timeout); controller.abort(); active.current?.abort(); };
  }, []);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (active.current || (!text.trim() && !selected)) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35_000);
    setRunning(true); setResult(null); setError('');
    try {
      const response = await fetch('/api/attack-demo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ text, ...(selected ? { presetId: selected } : {}), mode }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (controller.signal.aborted) { setError(attackErrorMessage('ATTACK_TIMEOUT')); return; }
      if (!response.ok) {
        setError(attackErrorMessage(record(value) ? value.error : undefined, response.status));
        if (response.status === 403) { setMode('mock'); setLiveBlocked(true); }
        return;
      }
      const next = parseAttackResult(value);
      if (!next) { setError(attackErrorMessage('ATTACK_BAD_RESPONSE')); return; }
      if (next.liveBlocked) { setLiveBlocked(true); setMode('mock'); }
      setResult(next);
    } catch { if (mounted.current) setError(attackErrorMessage(controller.signal.aborted ? 'ATTACK_TIMEOUT' : 'NETWORK_ERROR')); }
    finally { clearTimeout(timeout); active.current = null; if (mounted.current) setRunning(false); }
  }

  return <section className='attack-panel' aria-labelledby={`${id}-title`}>
    <header><p className='attack-eyebrow'>Judge playground · source: judge</p><h1 id={`${id}-title`}>Try to trick the agents</h1>
      <p>Choose an attack or write a malicious email or invoice. Follow what each agent observes and proposes, then read the server’s policy decision.</p></header>
    <form onSubmit={run}>
      <fieldset disabled={running} className='attack-presets'><legend>Attack presets</legend>
        {!presets && !presetError && <p role='status'>Loading presets…</p>}
        {presets?.presets.length === 0 && <p>No presets available. Write your own attack below.</p>}
        <div className='attack-chips'>{presets?.presets.map(preset => <button type='button' key={preset.id} aria-pressed={selected === preset.id}
          onClick={() => { setSelected(preset.id); setText(preset.text); }}>
          {preset.title}<small>{preset.senderDomain}</small>
        </button>)}</div>
      </fieldset>
      {presetError && <p role='alert' className='attack-error'>{presetError} You can still write your own attack and retry.</p>}
      <label htmlFor={`${id}-text`}>Your malicious email or invoice</label>
      <textarea id={`${id}-text`} rows={8} maxLength={2000} value={text} disabled={running} aria-describedby={`${id}-count ${id}-hint`}
        placeholder='Paste instructions that try to override the agents’ rules…' onChange={event => { setText(event.target.value); setSelected(undefined); }} />
      <p id={`${id}-count`} className='attack-help'>{text.length} / 2,000 characters · Editing a preset runs your custom text.</p>
      <p id={`${id}-hint`} className='attack-help'>Tip: include a sender, an amount and bank details, like the presets; plain prose is held as INVALID_INPUT.</p>
      <fieldset className='attack-mode' disabled={running}><legend>Run mode</legend>
        <label><input type='radio' name={`${id}-mode`} value='mock' checked={mode === 'mock'} onChange={() => setMode('mock')} /> Mock</label>
        <label><input type='radio' name={`${id}-mode`} value='live' checked={mode === 'live'} disabled={liveBlocked !== false}
          aria-describedby={`${id}-live-help`} onChange={() => setMode('live')} /> Live</label>
        <p id={`${id}-live-help`} className='attack-help'>{liveBlocked === true ? BLOCKED_HELP
          : liveBlocked === undefined ? 'Live is unavailable until the server reports whether it is enabled.' : LIVE_HELP}</p>
      </fieldset>
      <button className='attack-run' type='submit' disabled={running || (!text.trim() && !selected)}>{running ? 'Running…' : 'Run attack'}</button>
    </form>
    <div className='attack-results' aria-live='polite' aria-atomic='true' aria-busy={running}>
      {running && <p role='status'>Tracing the agents and checking policy… This may take up to 30 seconds.</p>}
      {error && <p role='alert' className='attack-error'>{error}</p>}
      {result && <>
        <p className='attack-eyebrow'>Completed · {result.mode} · source: {result.source}</p>
        <p className='attack-help'>Untrusted data · isolated synthetic company</p>
        <p>Sender: {result.senderDomain === 'unknown.invalid' ? 'unknown (your text)' : result.senderDomain}</p>
        {result.liveBlocked && <p>{BLOCKED_HELP}</p>}
        <h2>Agent trace</h2>
        <ol className='attack-trace'>{result.steps.map((step, index) => <li key={index}>
          <h3>{step.role} <span className='attack-execution'>{step.execution === 'live' ? 'live model' : step.execution}</span></h3>
          <dl><dt>Observed</dt><dd>{step.observed}</dd><dt>Proposed</dt><dd>{step.proposed}</dd>
            {step.decision !== undefined && <><dt>Decision</dt><dd>{typeof step.decision === 'string' ? step.decision : <>
              <strong>{step.decision.kind}</strong> · {step.decision.reason}<br />
              {step.decision.ruleIds.map((rule, i) => <code key={i}>{rule} </code>)} · Policy version {step.decision.policyVersion}
            </>}</dd></>}
          </dl>
        </li>)}</ol>
        {result.skippedRoles.length > 0 && <p>Not reached: {result.skippedRoles.join(', ')}</p>}
        <section className='attack-decision' aria-labelledby={`${id}-decision`}>
          <h2 id={`${id}-decision`}>Final decision: {result.decision.kind}</h2>
          <p className='attack-rules'>{result.decision.ruleIds.map((rule, index) => <code key={index}>{rule}</code>)}</p>
          <p>{result.decision.reason}</p><p>Policy version {result.decision.policyVersion}</p>
          {result.decision.quote !== undefined && <blockquote>{typeof result.decision.quote === 'string' ? result.decision.quote
            : <>{result.decision.quote.text}<br /><cite>{result.decision.quote.sentenceId}</cite></>}</blockquote>}
          {result.decision.toHuman !== undefined && <p>Sent to a human: {result.decision.toHuman}</p>}
          <h3>Rules that fired</h3>
          {result.rules.length ? <ul>{result.rules.map((rule, index) => <li key={index}><code>{rule.id}</code> · {rule.reason}</li>)}</ul>
            : <p>No rules fired.</p>}
          <p className={`attack-money${result.moneyMoved || result.paymentAttempts > 0 ? ' attack-error' : ''}`}
            role={result.moneyMoved || result.paymentAttempts > 0 ? 'alert' : undefined}>
            Money moved: {result.moneyMoved ? 'yes' : 'no'} · Payment attempts: {result.paymentAttempts}
          </p>
          {result.moneyMoved && <p role='alert' className='attack-error'>Unexpected money movement reported. Stop the demo and notify the operator.</p>}
        </section>
        {result.modelEvidence && <details className='attack-evidence'><summary>Model evidence</summary>
          <dl>{Object.entries(result.modelEvidence).map(([key, value]) => <div key={key}><dt>{key}</dt>
            <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl>
        </details>}
      </>}
    </div>
  </section>;
}
