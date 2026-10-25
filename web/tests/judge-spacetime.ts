/** Disposable real SpacetimeDB lane. No shared server, database or credentials. */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer, connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DbConnection } from '../../orchestrator/src/spacetime-client';

const MAX_ROWS = 500;
export interface JudgeSpacetimeRows {
  auditEntries: { id: string; seq: string; action: string; actor: string; decision?: string; refs: string[]; route: string; hash: string; prevHash: string }[];
  agentHandoffs: { handoffId: string; sequence: string; caseDisplayId: string; fromAgentId: string; toAgentId: string; status: string }[];
  escalations: { id: string; taskId: string; status: string; ruleIds: string[]; evidenceRefs: string[] }[];
  invoices: { id: string; kind: 'ar' | 'ap'; state: string }[];
  payments: { id: string; recorded: boolean }[];
}

// Discard child stdout/stderr on failure: CLI diagnostics may contain credentials.
function run(cli: string, args: string[], cwd: string, timeout = 120_000): Promise<string> {
  return new Promise((done, fail) => execFile(cli, args, { cwd, timeout, maxBuffer: 2_000_000, windowsHide: true }, (error, stdout) => {
    if (error) fail(new Error('JUDGE_SPACETIME_CLI_FAILED'));
    else done(stdout);
  }));
}

async function unusedPort(): Promise<number> {
  return new Promise((done, fail) => {
    const socket = createServer();
    socket.once('error', fail);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      if (!address || typeof address === 'string') { socket.close(); fail(new Error('JUDGE_SPACETIME_PORT_FAILED')); return; }
      socket.close(error => error ? fail(error) : done(address.port));
    });
  });
}

async function isListening(port: number): Promise<boolean> {
  return new Promise(done => {
    const socket = connect(port, '127.0.0.1');
    const finish = (value: boolean) => { socket.destroy(); done(value); };
    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function stopOwned(server: ChildProcess | undefined) {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>(done => {
    const force = setTimeout(() => server.kill('SIGKILL'), 3_000);
    server.once('exit', () => { clearTimeout(force); done(); });
    server.kill('SIGTERM');
  });
}

export async function bootJudgeSpacetime(repoRoot: string) {
  const cli = process.env.SPACETIME_CLI;
  if (!cli || !existsSync(cli)) throw new Error('JUDGE_SPACETIME_CLI_REQUIRED: set SPACETIME_CLI to the installed 2.13.0 binary');
  const version = await run(cli, ['--version'], repoRoot, 10_000);
  if (!/\b2\.13\.0\b/.test(version)) throw new Error('JUDGE_SPACETIME_CLI_VERSION_REQUIRED: 2.13.0');
  const scratch = await mkdtemp(join(tmpdir(), 'backroom-judge-db-'));
  const cliRoot = join(scratch, 'root');
  await mkdir(cliRoot);
  const configPath = join(scratch, 'cli.toml');
  const prefix = [`--root-dir=${cliRoot}`, `--config-path=${configPath}`];
  const port = await unusedPort();
  const uri = `ws://127.0.0.1:${port}`;
  const http = `http://127.0.0.1:${port}`;
  const database = `judge-${randomUUID()}`;
  let server: ChildProcess | undefined;
  let serverFailed = false;
  let closed = false;
  const observers = new Set<DbConnection>();
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const observer of observers) observer.disconnect();
    observers.clear();
    await stopOwned(server);
    // Only the unique directory created by this invocation is removed.
    if (dirname(resolve(scratch)) !== resolve(tmpdir()) || !basename(scratch).startsWith('backroom-judge-db-')) {
      throw new Error('JUDGE_SPACETIME_CLEANUP_PATH');
    }
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    server = spawn(cli, [...prefix, 'start', '--listen-addr', `127.0.0.1:${port}`, '--data-dir', join(scratch, 'data'), '--non-interactive'], {
      cwd: repoRoot, stdio: 'ignore', windowsHide: true,
    });
    server.once('error', () => { serverFailed = true; });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (serverFailed || server.exitCode !== null || server.signalCode !== null) throw new Error('JUDGE_SPACETIME_SERVER_EXITED');
      if (await isListening(port)) { ready = true; break; }
      await delay(100);
    }
    if (!ready) throw new Error('JUDGE_SPACETIME_START_TIMEOUT');
    await run(cli, [...prefix, 'publish', database, '--server', http, '--module-path', resolve(repoRoot, 'spacetime'), '--yes'], repoRoot);
    const token = /^spacetimedb_token\s*=\s*"([^\"]+)"/m.exec(await readFile(configPath, 'utf8'))?.[1];
    if (!token) throw new Error('JUDGE_SPACETIME_PUBLISHER_TOKEN_MISSING');

    async function privateRows(table: 'ar_invoice' | 'ap_invoice' | 'payment_receipt') {
      const columns = table === 'payment_receipt' ? 'id, json' : 'id, state';
      const response = await fetch(`${http}/v1/database/${database}/sql`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: `SELECT ${columns} FROM ${table} LIMIT ${MAX_ROWS + 1}`, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('JUDGE_SPACETIME_SQL_FAILED');
      const result = await response.json() as { rows?: unknown[][] }[];
      if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0]?.rows)) throw new Error('JUDGE_SPACETIME_SQL_SHAPE');
      const rows = result[0].rows;
      if (rows.length > MAX_ROWS) throw new Error('JUDGE_SPACETIME_PROOF_ROW_LIMIT');
      return rows.map(row => {
        if (typeof row[0] !== 'string' || (table !== 'payment_receipt' && typeof row[1] !== 'string')) throw new Error('JUDGE_SPACETIME_SQL_ROW_SHAPE');
        let recorded = false;
        if (table === 'payment_receipt') {
          // SpacetimeDB 2.13 SQL serializes Option as [0, value] or [1, []].
          const option = row[1];
          if (!Array.isArray(option) || option.length !== 2 || ![0, 1].includes(option[0])) throw new Error('JUDGE_SPACETIME_RECEIPT_OPTION');
          if (option[0] === 0) {
            if (typeof option[1] !== 'string') throw new Error('JUDGE_SPACETIME_RECEIPT_VALUE');
            const receipt = JSON.parse(option[1]) as { key?: unknown; result?: unknown };
            recorded = receipt.key === row[0] && typeof receipt.result === 'object' && receipt.result !== null;
          }
        }
        return { id: row[0], state: row[1] as string, recorded };
      });
    }

    async function readRows(): Promise<JudgeSpacetimeRows> {
      if (closed || serverFailed || server?.exitCode !== null || server?.signalCode !== null) throw new Error('JUDGE_SPACETIME_NOT_RUNNING');
      // A fresh anonymous connection proves rows survive writer/client reconnects.
      // No StateStore getters or runtime caches participate in this observation.
      let observer: DbConnection | undefined;
      try {
        const publicRows = await new Promise<Pick<JudgeSpacetimeRows, 'auditEntries' | 'agentHandoffs' | 'escalations'>>((done, fail) => {
          const timer = setTimeout(() => fail(new Error('JUDGE_SPACETIME_OBSERVER_TIMEOUT')), 10_000);
          const reject = () => { clearTimeout(timer); fail(new Error('JUDGE_SPACETIME_OBSERVER_FAILED')); };
          observer = DbConnection.builder().withUri(uri).withDatabaseName(database)
            .onConnect(connection => {
              connection.subscriptionBuilder().onError(reject).onApplied(() => {
                clearTimeout(timer);
                try {
                  const audit = [...connection.db.auditEntry.iter()];
                  const handoffs = [...connection.db.agentHandoffPublic.iter()];
                  const escalations = [...connection.db.escalation.iter()];
                  if ([audit, handoffs, escalations].some(rows => rows.length > MAX_ROWS)) throw new Error('JUDGE_SPACETIME_PROOF_ROW_LIMIT');
                  done({
                    auditEntries: audit.map(row => ({ id: row.id, seq: String(row.seq), action: row.action, actor: row.actor, decision: row.decision, refs: [...row.refs], route: row.route, hash: row.hash, prevHash: row.prevHash })),
                    agentHandoffs: handoffs.map(row => ({ handoffId: row.handoffId, sequence: String(row.sequence), caseDisplayId: row.caseDisplayId, fromAgentId: row.fromAgentId, toAgentId: row.toAgentId, status: row.status })),
                    escalations: escalations.map(row => ({ id: row.id, taskId: row.taskId, status: row.status, ruleIds: [...row.ruleIds], evidenceRefs: [...row.evidenceRefs] })),
                  });
                } catch { fail(new Error('JUDGE_SPACETIME_PUBLIC_PROOF_FAILED')); }
              }).subscribe(['SELECT * FROM audit_entry', 'SELECT * FROM agent_handoff_public', 'SELECT * FROM escalation']);
            }).onConnectError(reject).onDisconnect(reject).build();
          observers.add(observer);
        });
        const [ar, ap, payments] = await Promise.all([privateRows('ar_invoice'), privateRows('ap_invoice'), privateRows('payment_receipt')]);
        return { ...publicRows, invoices: [...ar.map(({ id, state }) => ({ id, state, kind: 'ar' as const })), ...ap.map(({ id, state }) => ({ id, state, kind: 'ap' as const }))], payments: payments.map(({ id, recorded }) => ({ id, recorded })) };
      } finally {
        if (observer) { observers.delete(observer); observer.disconnect(); }
      }
    }
    return { config: { uri, database, token }, readRows, close };
  } catch {
    await close();
    throw new Error('JUDGE_SPACETIME_BOOT_FAILED: verify the pinned CLI and local module build prerequisites');
  }
}
