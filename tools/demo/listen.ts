import { createServer, type RequestListener, type Server } from 'node:http';

/** Same handler/auth on both sockets; private voice registration must remain loopback. */
export async function listenDemo(handler: RequestListener, port: number, host: string) {
  const servers: Server[] = [];
  const close = async () => {
    await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
      if (!server.listening) { resolve(); return; }
      server.close(error => error ? reject(error) : resolve());
    })));
  };
  let selectedPort = port;
  try {
    for (const address of host === '127.0.0.1' ? [host] : [host, '127.0.0.1']) {
      const server = createServer(handler); servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(selectedPort, address, () => {
          server.removeListener('error', reject);
          const bound = server.address();
          if (bound && typeof bound !== 'string') selectedPort = bound.port;
          resolve();
        });
      });
    }
    return { port: selectedPort, close };
  } catch (error) { await close(); throw error; }
}
