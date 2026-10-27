import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { acceptKey, createFrameReader, createVoiceRelay, encodeFrame, voiceViewer } from './voice-relay';

const servers: Server[] = [], sockets = new Set<Socket>(), clients: WebSocket[] = [];
afterEach(async () => {
  clients.splice(0).forEach(client => client.close());
  sockets.forEach(socket => socket.destroy()); sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

it('accepts only the voice path with a well-formed viewer id', () => {
  expect(voiceViewer('/__voice?viewer=abcd-1234-ef')).toBe('abcd-1234-ef');
  for (const url of ['/__voice', '/__voice?viewer=short', '/__voice?viewer=bad%20id%20here', '/__state/x?viewer=abcd-1234-ef']) expect(voiceViewer(url)).toBeUndefined();
  // RFC 6455's worked example.
  expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

it('reads masked client frames split across chunks and rejects fragmented ones', () => {
  const frames: [number, string][] = [];
  const read = createFrameReader((opcode, payload) => frames.push([opcode, payload.toString()]));
  const mask = Buffer.from([1, 2, 3, 4]), payload = Buffer.from('hello');
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i & 3]!));
  const frame = Buffer.concat([Buffer.from([0x82, 0x80 | payload.length]), mask, masked]);
  expect(read(frame.subarray(0, 3))).toBe(true);
  expect(read(frame.subarray(3))).toBe(true);
  expect(frames).toEqual([[2, 'hello']]);
  expect(createFrameReader(() => {})(Buffer.from([0x02, 0x00]))).toBe(false);
  expect(encodeFrame(2, Buffer.alloc(300)).subarray(0, 4)).toEqual(Buffer.from([0x82, 126, 1, 44]));
});

async function relayServer() {
  const relay = createVoiceRelay();
  const server = createServer((_req, res) => res.end());
  server.on('connection', socket => sockets.add(socket));
  server.on('upgrade', (req, socket, head) => { if (!relay.upgrade(req, socket, head)) socket.destroy(); });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { relay, port: (server.address() as AddressInfo).port };
}
function connect(port: number, viewer: string) {
  const client = new WebSocket(`ws://127.0.0.1:${port}/__voice?viewer=${viewer}`);
  client.binaryType = 'arraybuffer';
  clients.push(client);
  const received: ArrayBuffer[] = [];
  client.addEventListener('message', event => received.push(event.data as ArrayBuffer));
  return { client, received, open: new Promise<void>((resolve, reject) => { client.addEventListener('open', () => resolve()); client.addEventListener('error', reject); }) };
}
const until = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10)); };

it('relays one speaker to everyone else, tagged with the speaker, never back to them', async () => {
  const { relay, port } = await relayServer();
  const alice = connect(port, 'alice-0001'), bob = connect(port, 'bob-000002'), carol = connect(port, 'carol-0003');
  await Promise.all([alice.open, bob.open, carol.open]);
  expect(relay.size()).toBe(3);
  alice.client.send(new Int16Array([1, -2, 3, -4]).buffer);
  await until(() => bob.received.length > 0 && carol.received.length > 0);
  for (const { received } of [bob, carol]) {
    const bytes = new Uint8Array(received[0]!);
    expect(new TextDecoder().decode(bytes.subarray(1, 1 + bytes[0]!))).toBe('alice-0001');
    expect([...new Int16Array(bytes.slice(1 + bytes[0]!).buffer)]).toEqual([1, -2, 3, -4]);
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(alice.received).toEqual([]);
});

it('drops a speaker over the byte budget instead of queueing', async () => {
  const { port } = await relayServer();
  const loud = connect(port, 'loud-00001'), ear = connect(port, 'ear-000001');
  await Promise.all([loud.open, ear.open]);
  for (let i = 0; i < 100; i++) loud.client.send(new Int16Array(320).buffer); // 64 kB in well under a second
  await until(() => ear.received.length >= 70);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(ear.received.length).toBe(75); // 48 kB / 640 B
});

it('refuses a bad viewer id and leaves other paths to the caller', async () => {
  const { relay, port } = await relayServer();
  const bad = new WebSocket(`ws://127.0.0.1:${port}/__voice?viewer=x`);
  clients.push(bad);
  await expect(new Promise((resolve, reject) => { bad.addEventListener('open', resolve); bad.addEventListener('error', reject); })).rejects.toBeTruthy();
  expect(relay.upgrade({ url: '/__state/v1/database/x/subscribe', headers: {} } as never, {} as never, Buffer.alloc(0))).toBe(false);
});
