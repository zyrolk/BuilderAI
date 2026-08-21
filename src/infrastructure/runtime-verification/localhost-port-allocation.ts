import { createServer } from 'node:net';

import { LOCALHOST_BIND_HOST } from '../../core/runtime-verification/policy/runtime-verification-policy';

export async function allocateLocalhostPort(preferredPort?: number): Promise<number> {
  if (preferredPort !== undefined) {
    const available = await isPortAvailable(preferredPort);
    if (available) return preferredPort;
  }
  return await reserveEphemeralPort();
}

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, LOCALHOST_BIND_HOST);
  });
}

function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, LOCALHOST_BIND_HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate an ephemeral port.')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export function buildLocalhostUrl(port: number, routePath: string): string {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `http://127.0.0.1:${port}${normalized}`;
}
