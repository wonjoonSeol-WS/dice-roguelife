// A standalone server on a free port with its own data folder, as the page sees it: its token and its picture cookie.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.js';

export const tempDir = () => mkdtempSync(join(tmpdir(), 'dr-standalone-'));
// what node tests need of the page is its token: a stub, not the game built for every server (null: build it)
const STUB_DIR = tempDir();
const STUB = join(STUB_DIR, 'page.html');
writeFileSync(STUB, '<!doctype html><script></script>');
process.on('exit', () => rmSync(STUB_DIR, { recursive: true, force: true }));

// the status a request with this Host header gets (fetch can't set Host)
export const hostStatus = (url, host) =>
  new Promise((resolve, reject) => {
    const req = request(url, { headers: { Host: host } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });

export async function openServer({ dataDir = tempDir(), pageFile = STUB, ...options } = {}) {
  const server = await startServer({
    port: 0,
    dataDir,
    configFile: join(dataDir, 'config.json'),
    pageFile,
    ...options,
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(url);
  const token = /window.DR_SERVER_TOKEN="([a-f0-9]+)"/.exec(await res.text())[1];
  const cookie = res.headers.get('set-cookie').split(';')[0];
  // a POST with the page's token; an object body is sent as JSON
  const call = (path, body, headers = {}) =>
    fetch(url + path, {
      method: 'POST',
      headers: { 'X-DR-Token': token, ...headers },
      body: body && typeof body === 'object' && !(body instanceof Uint8Array) ? JSON.stringify(body) : body,
    });
  const readJson = name => JSON.parse(readFileSync(join(dataDir, name), 'utf8'));
  // keep: leave the data folder for the next server
  const stop = async ({ keep = false } = {}) => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (!keep) rmSync(dataDir, { recursive: true, force: true });
  };
  return { url, cookie, call, readJson, stop, dataDir };
}
