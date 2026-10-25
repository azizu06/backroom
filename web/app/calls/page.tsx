'use client';
import { useState } from 'react';
import { signInOperator } from '../../lib/operator/sign-in-client';
import styles from '../approve/[id]/approval.module.css';

/** Operator sign-in, worded for the office desk phone's Request call button. Same session as /operator. */
export default function CallUnlock() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  async function unlock() {
    setBusy(true); setResult(undefined);
    try { setResult({ ok: true, message: await signInOperator(code) }); setCode(''); }
    catch (e) { setResult({ ok: false, message: e instanceof Error ? e.message : 'Sign-in failed. Try again.' }); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}><div className={styles.sheet}>
    <p className={styles.status}>Operator setup</p>
    <h1>Unlock the<br />desk phone.</h1>
    <p className={styles.intro}>Request call on the office desk phone then rings the approved demo phone. The agent says it is an AI before anything else.</p>
    {result && <p className={result.ok ? styles.status : styles.error} role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
    {result?.ok ? <p className={styles.section}><a href="/office">Back to the office</a></p>
      : <form className={styles.section} onSubmit={e => { e.preventDefault(); void unlock(); }}>
        <div className={styles.fields}><label>Operator code<input type="password" autoComplete="off" required value={code} onChange={e => setCode(e.target.value)} /></label></div>
        <p><button className={styles.primary} disabled={busy || !code}>{busy ? 'Unlocking…' : 'Unlock office calls'}</button></p>
      </form>}
    <footer className={styles.footer}>Northfield Studio · Office calls</footer>
  </div></main>;
}
