import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SIMPLE_SERVER = `
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const root = path.join(__dirname, 'public');
http.createServer((request, response) => {
  const relative = request.url === '/' ? 'index.html' : request.url.replace(/^\\//, '');
  const filePath = path.join(root, relative);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('missing');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(data);
  });
}).listen(port, host, () => process.stdout.write('ready\\n'));
`.trim();

export function createSimpleWebFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-p08-simple-'));
  mkdirSync(path.join(root, 'public'), { recursive: true });
  writeFileSync(
    path.join(root, 'public', 'index.html'),
    '<!doctype html><html><head><title>Fixture App</title></head><body><div id="root">Hello</div></body></html>',
  );
  writeFileSync(path.join(root, 'server.js'), SIMPLE_SERVER);
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'node server.js' } }),
  );
  return root;
}

export function createBrokenJsFixture(): string {
  const root = createSimpleWebFixture();
  writeFileSync(
    path.join(root, 'public', 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script>throw new Error("fixture-boom")</script></body></html>',
  );
  return root;
}

export function createMissingResourceFixture(): string {
  const root = createSimpleWebFixture();
  writeFileSync(
    path.join(root, 'public', 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script src="/missing.js"></script></body></html>',
  );
  return root;
}

export function createServerFailureFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-p08-fail-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'node -e "process.exit(1)"' } }),
  );
  return root;
}

export function createStartupTimeoutFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-p08-timeout-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'node -e "setInterval(()=>{}, 999999)"' } }),
  );
  return root;
}

export function createNoDevScriptFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-p08-nodev-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { build: 'node -e 0' } }),
  );
  return root;
}
