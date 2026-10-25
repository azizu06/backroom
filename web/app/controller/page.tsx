'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { Escalation } from '@backroom/orchestrator';
import { ApprovalError, approvalRequest } from '../../lib/approvals/client';
import { createControllerAlert } from '../../lib/approvals/alert';
import ApprovalCard from '../approve/[id]/ApprovalCard';
import styles from '../approve/[id]/approval.module.css';
import inbox from './controller.module.css';

const POLL_MS = 1500;
const money = (row: Escalation) => row.amountCents === undefined ? row.taskId
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency ?? 'USD' }).format(row.amountCents / 100);

export default function Controller() {
  const [secret, setSecret] = useState('');
  // undefined until the server answers, so the enrollment form never flashes for an already-registered Dana.
  const [registered, setRegistered] = useState<boolean>();
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = useCallback(() => {
    setError('');
    void approvalRequest('/api/controller/view').then(data => { setRegistered(Boolean(data.registered)); setSignedIn(Boolean(data.signedIn)); })
      .catch(e => setError(e instanceof Error ? e.message : 'Passkey status could not be loaded. Try again.'));
  }, []);
  useEffect(check, [check]);
  const alert = useRef<ReturnType<typeof createControllerAlert>>(undefined);
  alert.current ??= createControllerAlert();
  async function register() {
    setBusy(true); setError('');
    try {
      const { options, challengeId } = await approvalRequest('/api/controller/register-options', { secret });
      const response = await startRegistration({ optionsJSON: options });
      await approvalRequest('/api/controller/register', { secret, challengeId, response });
      setRegistered(true); setSecret('');
    } catch (e) { setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Passkey setup was canceled. You can try again.' : e instanceof Error ? e.message : 'Passkey setup failed. Try again.'); }
    finally { setBusy(false); }
  }
  async function signIn() {
    alert.current?.unlock();
    setBusy(true); setError('');
    try {
      const { options, challengeId } = await approvalRequest('/api/controller/session-options', {});
      const response = await startAuthentication({ optionsJSON: options });
      await approvalRequest('/api/controller/session', { challengeId, response });
      setSignedIn(true);
    } catch (e) { setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Passkey sign-in was canceled. You can try again.' : e instanceof Error ? e.message : 'Passkey sign-in failed. Try again.'); }
    finally { setBusy(false); }
  }
  const signedOut = useCallback(() => setSignedIn(false), []);
  if (registered && signedIn) return <Inbox alert={alert.current} onSignedOut={signedOut} />;
  return <main className={styles.page}><div className={styles.sheet}>
    <h1>Dana’s controller</h1>
    <p className={styles.intro}>Keep this page open on your phone during the call. Requests from the clerk ring here, and each decision asks you to confirm on your own device.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {registered === undefined ? (error
      ? <p className={styles.section}><button className={styles.secondary} onClick={check}>Check passkey status again</button></p>
      : <p className={styles.section} role="status">Checking Dana’s passkey…</p>)
    : registered ? <section className={styles.result} role="status"><h2>Dana’s passkey is ready.</h2>
        <p>Sign in to keep live requests on this screen. Signing in only shows requests; every decision still needs its own passkey confirmation.</p>
        <p><button className={styles.primary} disabled={busy} onClick={() => void signIn()}>{busy ? 'Confirm on your device…' : 'Sign in with passkey'}</button></p>
      </section>
      : <form className={styles.section} onSubmit={e => { e.preventDefault(); void register(); }}>
        <div className={styles.fields}><label>Controller enrollment code<input type="password" autoComplete="off" required value={secret} onChange={e => setSecret(e.target.value)} /></label></div>
        <p className={styles.note}>Use the private code provided by your Backroom operator.</p>
        <p><button className={styles.primary} disabled={busy || !secret}>{busy ? 'Confirm on your device…' : 'Create Dana’s passkey'}</button></p>
      </form>}
  </div></main>;
}

function Inbox({ alert, onSignedOut }: { alert: ReturnType<typeof createControllerAlert>; onSignedOut: () => void }) {
  const [pending, setPending] = useState<Escalation[]>();
  const [currentId, setCurrentId] = useState<string>();
  const [live, setLive] = useState(true);
  const [awake, setAwake] = useState(false);
  const [sound, setSound] = useState(alert.soundReady);
  const [, tick] = useState(0);
  const seen = useRef(new Set<string>());
  const current = useRef<string>(undefined);
  current.current = currentId;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One request at a time, as on the approval page: the next poll waits for the last one to settle.
    const poll = async () => {
      try {
        const { escalations } = await approvalRequest('/api/controller/inbox') as { escalations: Escalation[] };
        if (!active) return;
        const fresh = escalations.filter(row => !seen.current.has(row.id));
        for (const row of fresh) seen.current.add(row.id);
        setPending(escalations); setLive(true);
        if (fresh.length) {
          alert.ring();
          // Never pull a still-pending card out from under Dana; a newer request waits in the queue.
          // A recorded or expired card has nothing left to decide, so the new request takes its place.
          const reviewing = current.current && escalations.some(row => row.id === current.current);
          if (!reviewing) setCurrentId(fresh[0]!.id);
        }
      } catch (e) {
        if (!active) return;
        if (e instanceof ApprovalError && e.code === 'SESSION_REQUIRED') { active = false; onSignedOut(); return; }
        setLive(false);
      }
      if (active) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [alert, onSignedOut]);
  useEffect(() => {
    const wake = () => { if (document.visibilityState === 'visible') void alert.keepAwake().then(setAwake); };
    // iOS resumes audio only inside a gesture; any tap on the page arms the chime.
    const arm = () => { alert.unlock(); setTimeout(() => setSound(alert.soundReady), 50); };
    wake();
    document.addEventListener('visibilitychange', wake);
    document.addEventListener('pointerdown', arm);
    const clock = setInterval(() => tick(n => n + 1), 1000);
    return () => {
      document.removeEventListener('visibilitychange', wake); document.removeEventListener('pointerdown', arm); clearInterval(clock);
      alert.releaseAwake();
    };
  }, [alert]);
  const waiting = pending?.length ?? 0;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) Approval needed · Backroom` : 'Controller · Backroom';
    return () => { document.title = 'Controller · Backroom'; };
  }, [waiting]);
  const others = (pending ?? []).filter(row => row.id !== currentId);
  const seconds = (row: Escalation) => Math.max(0, Math.ceil((row.expiresAt - Date.now()) / 1000));
  return <main className={styles.page}><div className={styles.sheet}>
    <header className={styles.header}>
      <span className={inbox.live} data-state={live ? 'live' : 'retry'} role="status">{live ? 'Live' : 'Reconnecting…'}</span>
    </header>
    <div className={inbox.bar}>
      <span>Dana · Controller</span>
      <span>{waiting ? `${waiting} waiting` : 'Inbox clear'}</span>
    </div>
    {!sound && <button className={`${styles.secondary} ${inbox.sound}`} onClick={() => { alert.unlock(); alert.ring(); setTimeout(() => setSound(alert.soundReady), 50); }}>Tap to turn on the request chime</button>}
    {others.length > 0 && <section className={inbox.queue} aria-label="Also waiting">
      <h2>{currentId ? 'Also waiting' : 'Waiting for you'}</h2>
      {others.map(row => <button key={row.id} className={inbox.item} onClick={() => setCurrentId(row.id)}>
        <span>{row.invoiceId ? `Invoice ${row.invoiceId}` : row.taskId}</span><strong>{money(row)}</strong><em>{seconds(row)}s</em>
      </button>)}
    </section>}
    {currentId ? <>
      <ApprovalCard key={currentId} id={currentId} embedded />
      {!pending?.some(row => row.id === currentId) && <p><button className={styles.secondary} onClick={() => setCurrentId(undefined)}>Back to inbox</button></p>}
    </> : pending === undefined ? <p className={styles.section} role="status">Connecting to the clerk…</p>
      : !others.length && <section className={inbox.empty}>
        <h1>All clear.</h1>
        <p>No requests are waiting. Keep this screen open; a new request rings and opens here by itself.</p>
        <ul>
          <li data-on={live}>{live ? 'Listening for the clerk' : 'Reconnecting to Backroom'}</li>
          <li data-on={sound}>{sound ? 'Chime on' : 'Chime off until you tap the screen'}</li>
          <li data-on={awake}>{awake ? 'Screen stays awake' : 'Screen may lock; keep it awake in settings'}</li>
        </ul>
      </section>}
    <footer className={styles.footer}>Northfield Studio · Signed in with Dana’s passkey · Voice can never approve</footer>
  </div></main>;
}
