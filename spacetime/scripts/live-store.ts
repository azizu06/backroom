/** Opt-in local-only integration lane. Creates fresh DBs and owns its server. */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { DbConnection } from '../../orchestrator/src/spacetime-client';
import { MemoryStateStore } from '../../orchestrator/src/memory-store';
import { SpacetimeStateStore, SpacetimeTransport, type StateTransport } from '../../orchestrator/src/spacetime-store';
import { issueVerifiedApproval } from '../../orchestrator/src/approvals/verified';
import { canonicalAuditJson } from '../../orchestrator/src/audit';
import { runCoreDemo } from '../../orchestrator/src/core-demo/core';
import type { StateStore, AuditEntry } from '../../orchestrator/src/store';

async function main() {
  if (process.env.SPACETIME_LIVE !== '1') throw new Error('Set SPACETIME_LIVE=1 for disposable local DB writes');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const cli = process.env.SPACETIME_CLI ?? resolve(root, '.t8-tools/spacetime/spacetime');
  const cliRoot = process.env.SPACETIME_ROOT ?? resolve(root, '.t8-tools/spacetime');
  if (!existsSync(cli)) throw new Error('Install the pinned SpacetimeDB 2.13.0 CLI first; see spacetime/README.md');
  const scratch = resolve(root, `.t8-tools/store-live-${Date.now()}`);
  mkdirSync(scratch, { recursive: true });
  const config = resolve(scratch, 'cli.toml');
  const prefix = [`--root-dir=${cliRoot}`, `--config-path=${config}`];
  const port = await new Promise<number>(resolvePort => {
    const server = createServer(); server.listen(0, '127.0.0.1', () => {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_LOCAL_PORT');
      server.close(() => resolvePort(address.port));
    });
  });
  const uri = `ws://127.0.0.1:${port}`;
  const http = `http://127.0.0.1:${port}`;
  const server = spawn(cli, [...prefix, 'start', '--listen-addr', `127.0.0.1:${port}`, '--data-dir', resolve(scratch, 'db'), '--in-memory', '--non-interactive'], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
  const stores: SpacetimeStateStore[] = [];
  let observer: DbConnection | undefined;
  try {
    let started = false;
    for (let i = 0; i < 100; i++) {
      started = await new Promise<boolean>(done => { const socket = connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); done(true); }); socket.once('error', () => done(false)); });
      if (started) break;
      await delay(100);
    }
    assert(started, 'local server did not start');
    const database = `backroom-state-${Date.now()}`;
    for (const suffix of ['', '-on', '-off', '-ap', '-parity']) execFileSync(cli, [...prefix, 'publish', database + suffix, '--server', http, '--module-path', 'spacetime', '--yes'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    // This CLI config belongs solely to this disposable run. Never print its token.
    const token = /^spacetimedb_token\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1];
    assert(token, 'local publisher token missing');
    const tape: { method: string; values: unknown[] }[] = [];
    const transport = new SpacetimeTransport({ uri, database: database + '-parity', token });
    const recording: StateTransport = {
      ready: transport.ready, onControl: listener => transport.onControl(listener), close: () => transport.close(),
      async invoke(method, values) {
        const result = await transport.invoke(method, values);
        tape.push({ method, values: structuredClone(values) }); return result;
      },
    };
    const targets: string[] = [];
    const auditLagMs: number[] = [];
    await new Promise<void>((resolveObserver, reject) => {
      observer = DbConnection.builder().withUri(uri).withDatabaseName(database + '-parity')
        .onConnect(connection => {
          connection.db.agent.onUpdate((_ctx, _before, row) => { targets.push(row.targetAnchor); });
          connection.db.auditEntry.onInsert((_ctx, row) => { auditLagMs.push(Date.now() - row.ts); });
          connection.subscriptionBuilder().onApplied(() => resolveObserver()).onError(() => reject(new Error('OBSERVER_SUBSCRIPTION_FAILED')))
            .subscribe(['SELECT * FROM agent', 'SELECT * FROM room', 'SELECT * FROM escalation', 'SELECT * FROM audit_entry', 'SELECT * FROM server_results']);
        }).onConnectError(() => reject(new Error('OBSERVER_CONNECT_FAILED'))).build();
    });
    const durable = new SpacetimeStateStore({ transport: recording }); stores.push(durable);
    await durable.ready;
    const run = await runCoreDemo({ store: durable });
    assert(run.chainValid);
    for (let i = 0; i < 100 && observer!.db.auditEntry.count() < run.entries.length; i++) await delay(10);
    assert(targets.includes('Dana_desk'));
    assert.equal(Number(observer!.db.auditEntry.count()), run.entries.length);
    assert.equal(Number(observer!.db.serverResults.count()), 0, 'anonymous view leaked server responses');
    assert(auditLagMs.length === run.entries.length && auditLagMs.every(ms => ms >= 0 && ms <= 1000));
    console.log(`PASS: anonymous office subscription observes Dana target and all audits; max local row latency ${Math.max(...auditLagMs)}ms`);
    // Replay exactly the successful StateStore calls (including gateway UUIDs and
    // public credential IDs) through the public memory adapter, preserving data.
    const memory = new MemoryStateStore();
    for (const entry of tape) {
      const method = entry.method === 'setAgentTargetLeased' ? 'setAgentTarget' : entry.method;
      const values = structuredClone(entry.values);
      if (method === 'decideEscalation') values[0] = issueVerifiedApproval(values[0] as Parameters<typeof issueVerifiedApproval>[0]);
      const fn = memory[method as keyof StateStore] as (...args: unknown[]) => Promise<unknown>;
      await fn.apply(memory, values);
    }
    const normalize = (entries: AuditEntry[]) => entries.map(({ ts, hash, prevHash, ...entry }) => entry);
    assert.equal(canonicalAuditJson(normalize(run.entries)), canonicalAuditJson(normalize(await memory.listAudit())));
    assert((await memory.verifyAuditChain()).valid);
    console.log(`PASS: ${run.entries.length} audit entries equal memory modulo timestamps and their derived hashes; both chains valid`);

    const peer = new SpacetimeStateStore({ uri, database: database + '-parity', token }); stores.push(peer); await peer.ready;
    const old = peer.llmSignal;
    await durable.setLlmEnabled(false);
    for (let i = 0; i < 100 && peer.llmEnabled; i++) await delay(10);
    assert(!peer.llmEnabled && old.aborted, 'OFF did not reach peer subscription');
    await durable.setLlmEnabled(true);
    for (let i = 0; i < 100 && !peer.llmEnabled; i++) await delay(10);
    assert(peer.llmEnabled && !peer.llmSignal.aborted && old.aborted);
    await peer.close(); stores.splice(stores.indexOf(peer), 1);
    const resumed = new SpacetimeStateStore({ uri, database: database + '-parity', token }); stores.push(resumed); await resumed.ready;
    assert.equal((await resumed.getTask('collect-1042'))?.status, 'done');
    assert((await resumed.verifyAuditChain()).valid);
    const anonymous = await fetch(`${http}/v1/database/${database}-parity/call/set_llm_enabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(['attack', '[false]']) });
    assert(!anonymous.ok && (await anonymous.text()).includes('CONTROLLER_REQUIRED'));
    console.log('PASS: cross-client OFF/ON fencing, reconnect reads, anonymous writer rejection');

    const output = execFileSync('pnpm', ['demo:core'], { cwd: root, env: { ...process.env, STATE_STORE: 'spacetime', SPACETIMEDB_URI: uri, SPACETIMEDB_DATABASE: database, SPACETIMEDB_TOKEN: token }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    assert(output.includes('PASS: core loop,'));
    assert(output.includes('AUDIT chain valid=true'));
    writeFileSync(resolve(scratch, 'demo.log'), output);
    writeFileSync(resolve(scratch, 'proof.json'), JSON.stringify({ local: true, database, auditEntries: run.entries.length, auditParity: true, crossClientOff: true, reconnect: true, anonymousRejected: true, demoCore: true, maincloud: 'deferred: browser authentication required' }, null, 2));
    console.log(`PASS: STATE_STORE=spacetime pnpm demo:core; evidence ${scratch}/proof.json`);
    server.kill('SIGTERM');
    for (let i = 0; i < 100 && durable.llmEnabled; i++) await delay(10);
    assert(!durable.llmEnabled && durable.llmSignal.aborted, 'disconnect did not fence models');
    console.log('PASS: server disconnect fails closed');
  } finally {
    observer?.disconnect();
    await Promise.all(stores.map(store => store.close()));
    server.kill('SIGTERM');
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message.slice(0, 300) : 'LOCAL_STATE_LIVE_FAILED'); process.exitCode = 1; });
