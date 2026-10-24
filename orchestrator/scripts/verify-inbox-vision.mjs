/** Run after pnpm -r build. Production API + real PDF worker; model HTTP is mocked. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = JSON.parse(await readFile(`${root}/fixtures/vision/manifest.json`, 'utf8'));
const c = cases.find(c => c.id === 'multi-page-bank-change');
let requests = 0;
const mock = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(body.model, 'qwen2.5vl:7b');
  assert.equal(body.messages[1].content.filter(block => block.type === 'image_url').length, 2);
  requests++;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ output: c.expected, confidence: .99 }) } }] }));
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const origin = `http://localhost:${port}`;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
  cwd: `${root}/web`, env: { ...process.env, GX10_BASE_URL: `http://127.0.0.1:${mock.address().port}/v1`, GX10_ENABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c);
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${origin}/inbox`)).ok) { ready = true; break; } } catch { /* server boot */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'production server failed to boot');
  const form = new FormData();
  form.set('kind', 'invoice'); form.set('text', ''); form.set('senderDomain', c.senderDomain);
  form.set('attachment', new File([await readFile(`${root}/fixtures/vision/${c.file}`)], c.file, { type: c.mediaType }));
  const response = await fetch(`${origin}/api/inbox`, { method: 'POST', headers: { origin }, body: form });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.attachmentParsed, true);
  assert.equal(body.documentRoute, 'local');
  assert.equal(body.fields.invoiceId, '4471');
  assert.ok(body.decision.ruleIds.includes('LOOKALIKE_DOMAIN'));
  assert.ok(body.decision.ruleIds.includes('BANK_CHANGE_HOLD'));
  assert.equal(requests, 1);
  console.log('PASS production PDF -> 2 inline image pages -> mocked vision -> code bank-change/lookalike hold');
} catch (error) { console.error(output); throw error; }
finally {
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
  await new Promise(resolve => mock.close(resolve));
}
