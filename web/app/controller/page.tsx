'use client';
import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { approvalRequest } from '../../lib/approvals/client';
import styles from '../approve/[id]/approval.module.css';

export default function ControllerSetup() {
  const [secret, setSecret] = useState('');
  // undefined until the server answers, so the enrollment form never flashes for an already-registered Dana.
  const [registered, setRegistered] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = useCallback(() => {
    setError('');
    void approvalRequest('/api/controller/view').then(data => setRegistered(Boolean(data.registered)))
      .catch(e => setError(e instanceof Error ? e.message : 'Passkey status could not be loaded. Try again.'));
  }, []);
  useEffect(check, [check]);
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
  return <main className={styles.page}><div className={styles.sheet}>
    <header className={styles.header}><a href="/">Backroom</a><span>Dana’s desk</span></header>
    <p className={styles.status}>Controller setup</p>
    <h1>Your authority.<br />Your passkey.</h1>
    <p className={styles.intro}>Set up Dana’s passkey before the call. Each decision will ask you to confirm on your own device.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {registered === undefined ? (error
      ? <p className={styles.section}><button className={styles.secondary} onClick={check}>Check passkey status again</button></p>
      : <p className={styles.section} role="status">Checking Dana’s passkey…</p>)
    : registered ? <section className={styles.result} role="status"><h2>Dana’s passkey is ready.</h2><p>Open an approval link to review the clerk’s request.</p></section>
      : <form className={styles.section} onSubmit={e => { e.preventDefault(); void register(); }}>
        <div className={styles.fields}><label>Controller enrollment code<input type="password" autoComplete="off" required value={secret} onChange={e => setSecret(e.target.value)} /></label></div>
        <p className={styles.note}>Use the private code provided by your Backroom operator.</p>
        <p><button className={styles.primary} disabled={busy || !secret}>{busy ? 'Confirm on your device…' : 'Create Dana’s passkey'}</button></p>
      </form>}
    <footer className={styles.footer}>Northfield Studio · Controller review</footer>
  </div></main>;
}
