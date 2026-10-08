import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { adoptOldData, checkConfig } from '../server.js';
import { openStore } from '../store.js';
import { hostStatus, openServer, tempDir } from './support.js';

function withStore(run) {
  const dir = tempDir();
  const store = openStore(dir);
  try {
    return run(store, dir);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('documents: get, set, delete, add, as memDB does', () =>
  withStore(({ docOp }) => {
    const path = 'data/users/local/settings';
    assert.deepEqual(docOp({ op: 'get', path }), { exists: false, data: undefined });
    docOp({ op: 'set', path, data: { a: 1, b: { c: 2 } } });
    assert.deepEqual(docOp({ op: 'get', path }).data, { a: 1, b: { c: 2 } });
    const { id } = docOp({ op: 'add', path: 'hall', data: { score: 5 } });
    assert.equal(docOp({ op: 'get', path: 'hall/' + id }).data.score, 5);
    docOp({ op: 'delete', path: 'hall/' + id });
    assert.equal(docOp({ op: 'get', path: 'hall/' + id }).exists, false);
    assert.throws(() => docOp({ op: 'get', path: 'hall' }), { code: 'invalid_path' });
    assert.throws(() => docOp({ op: 'query', path: 'hall/x' }), { code: 'invalid_path' });
    assert.throws(() => docOp({ op: 'set', path: 'a/../b/c', data: {} }), { code: 'invalid_path' });
  }));

test('queries: direct children only, where, orderBy and limit', () =>
  withStore(({ docOp }) => {
    const col = 'data/users/local/saves/items/s1/pages';
    for (const p of [3, 1, 4, 2])
      docOp({ op: 'set', path: `${col}/p${p}`, data: { p, first: p * 10, turns: [{ p }] } });
    docOp({ op: 'set', path: `${col}/p1/deeper/x`, data: { p: 99 } });
    const ids = q => docOp({ op: 'query', path: col, ...q }).docs.map(d => d.id);
    assert.deepEqual(ids({ order: ['p', 'asc'] }), ['p1', 'p2', 'p3', 'p4']);
    assert.deepEqual(ids({ where: [['p', '>', 1]], order: ['p', 'asc'], limit: 2 }), ['p2', 'p3']);
    assert.deepEqual(ids({ where: [['first', '<=', 20]], order: ['first', 'desc'] }), ['p2', 'p1']);
    assert.deepEqual(ids({ where: [['p', '==', 4]] }), ['p4']);
    assert.deepEqual(docOp({ op: 'query', path: col, where: [['p', '==', 4]] }).docs[0].data.turns, [{ p: 4 }]);
    assert.throws(() => ids({ where: [["p') OR 1=1 --", '>', 0]] }), { code: 'invalid_query' });
    assert.throws(() => ids({ where: [['p', 'in', [1]]] }), { code: 'invalid_query' });
  }));

test('the server keeps saves and images across restarts, and images need the page cookie', async () => {
  let s = await openServer();
  const { dataDir } = s;
  try {
    await s.call('/api/db', { op: 'set', path: 'data/users/local/saves/items/a', data: { n: 1 } });
    const png = new Uint8Array([137, 80, 78, 71]);
    const { id } = await (await s.call('/api/assets/upload', png, { 'Content-Type': 'image/png' })).json();
    assert.equal((await fetch(`${s.url}/assets/${id}`)).status, 403);
    assert.equal((await s.call('/api/db', '{}', { 'X-DR-Token': 'wrong' })).status, 403);
    await s.stop({ keep: true });

    s = await openServer({ dataDir });
    const got = await (await s.call('/api/db', { op: 'get', path: 'data/users/local/saves/items/a' })).json();
    assert.deepEqual(got, { exists: true, data: { n: 1 } });
    const img = await fetch(`${s.url}/assets/${id}`, { headers: { Cookie: s.cookie } });
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await img.arrayBuffer()), png);
    const list = await (await s.call('/api/assets/list', '{}')).json();
    assert.deepEqual(
      list.files.map(f => [f.id, f.contentType, f.size]),
      [[id, 'image/png', 4]],
    );
    await s.call('/api/assets/delete', { id });
    assert.equal((await fetch(`${s.url}/assets/${id}`, { headers: { Cookie: s.cookie } })).status, 404);
  } finally {
    await s.stop();
  }
});

test('connection profiles: keys stay on the server, kept per profile, renamed, switched and deleted', async () => {
  const s = await openServer();
  const call = async (path, body) => {
    const r = await s.call(path, body);
    return r.ok ? r.json() : { status: r.status, ...(await r.json()) };
  };
  const paid = { endpoint: 'https://a.example/v1', model: 'm' };
  const local = { endpoint: 'http://localhost:11434/v1', model: 'llama' };
  try {
    let v = await call('/api/connection/set', { name: 'Paid', config: paid, apiKey: 'secret-1' });
    assert.deepEqual(v, { active: 'Paid', profiles: [{ name: 'Paid', config: paid, hasKey: true }] });
    v = await call('/api/connection/set', { name: 'Local', config: local });
    assert.deepEqual(
      [v.active, v.profiles.map(p => [p.name, p.hasKey])],
      [
        'Local',
        [
          ['Paid', true],
          ['Local', false],
        ],
      ],
    );
    assert.equal((await call('/api/connection/set', { name: 'Paid', config: local })).code, 'name_taken');
    // a blank key keeps the profile's own; a rename keeps it too
    await call('/api/connection/set', { name: 'Paid', previous: 'Paid', config: { ...paid, model: 'm2' } });
    v = await call('/api/connection/set', { name: 'Work', previous: 'Paid', config: { ...paid, model: 'm2' } });
    assert.deepEqual(
      v.profiles.map(p => [p.name, p.hasKey]),
      [
        ['Local', false],
        ['Work', true],
      ],
    );
    assert.equal(s.readJson('connection.json').profiles.Work.apiKey, 'secret-1');
    assert.equal(JSON.stringify(await call('/api/connection/get', {})).includes('secret-1'), false);
    // another endpoint without a new key drops the old one
    v = await call('/api/connection/set', {
      name: 'Work',
      previous: 'Work',
      config: { ...paid, endpoint: 'https://b.example/v1' },
    });
    assert.equal(v.profiles.find(p => p.name === 'Work').hasKey, false);
    assert.equal((await call('/api/connection/use', { name: 'Local' })).active, 'Local');
    assert.equal((await call('/api/connection/use', { name: 'Nope' })).status, 400);
    v = await call('/api/connection/delete', { name: 'Local' });
    assert.deepEqual([v.active, v.profiles.map(p => p.name)], ['Work', ['Work']]);
  } finally {
    await s.stop();
  }
});

test('bad requests never stop the server; image lists are kept; stored files run in a sandbox', async () => {
  const s = await openServer();
  const port = new URL(s.url).port;
  const raw = line =>
    new Promise((resolve, reject) => {
      const sock = connect(port, '127.0.0.1', () => sock.end(`${line} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
      sock.on('data', d => resolve(String(d).split('\r\n')[0]));
      sock.on('error', reject);
    });
  try {
    assert.match(await raw('GET //['), /^HTTP\/1\.1 [45]\d\d/);
    const manifest = await s.call('/api/assets/upload', '{"images":[]}', { 'Content-Type': 'application/json' });
    const { id } = await manifest.json();
    const back = await fetch(`${s.url}/assets/${id}`, { headers: { Cookie: s.cookie } });
    assert.equal(await back.text(), '{"images":[]}');
    assert.match(back.headers.get('content-security-policy'), /sandbox/);
    const html = await s.call('/api/assets/upload', '<script>', { 'Content-Type': 'text/html' });
    assert.equal(html.status, 400);
    assert.equal((await fetch(s.url)).status, 200);
  } finally {
    await s.stop();
  }
});

test('config.json: checked at start, so a bad file stops the server with a clear message', async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ hosts: 'my-pc' }));
    await assert.rejects(openServer({ dataDir: dir }), { code: 'bad_settings' });
    assert.throws(() => checkConfig({ port: 70000 }), { code: 'bad_settings' });
    assert.deepEqual(checkConfig({ port: 3100, dataDir: 'my-data', hosts: ['my-pc.tail1234.ts.net'] }).port, 3100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('server settings from ⚙: written to config.json, names allowed at once, port and folder after a restart', async () => {
  const s = await openServer();
  const port = Number(new URL(s.url).port);
  try {
    const now = await (await s.call('/api/server/get', {})).json();
    assert.deepEqual(now, { port: 3000, dataDir: '', hosts: [], running: { port, dataPath: s.dataDir } });
    const r = await (
      await s.call('/api/server/set', { port, dataDir: 'data', hosts: ['my-pc.tail1234.ts.net'] })
    ).json();
    assert.deepEqual(r, { restart: true }); // a data folder inside the one with config.json
    assert.deepEqual(s.readJson('config.json'), { port, dataDir: 'data', hosts: ['my-pc.tail1234.ts.net'] });
    assert.equal(await hostStatus(s.url, 'my-pc.tail1234.ts.net'), 200);
    // an empty folder is the default again, and leaves config.json
    const back = { port, dataDir: '', hosts: ['my-pc.tail1234.ts.net'] };
    assert.deepEqual(await (await s.call('/api/server/set', back)).json(), { restart: false });
    assert.equal('dataDir' in s.readJson('config.json'), false);
    for (const bad of [{ port: 0 }, { hosts: ['bad host/'] }, { dataDir: 5 }]) {
      const res = await s.call('/api/server/set', bad);
      assert.deepEqual([res.status, await res.json()], [400, { code: 'bad_settings' }]);
    }
  } finally {
    await s.stop();
  }
});

test('names as people type them: Tailscale names in capitals, profiles named like object properties', async () => {
  const s = await openServer({ hosts: checkConfig({ hosts: ['DESKTOP-AB12.Tail1234.ts.net'] }).hosts });
  try {
    assert.equal(await hostStatus(s.url, 'desktop-ab12.tail1234.ts.net'), 200);
    const config = { endpoint: 'http://localhost:11434/v1', model: 'llama' };
    const v = await (await s.call('/api/connection/set', { name: 'constructor', config })).json();
    assert.deepEqual(
      v.profiles.map(p => p.name),
      ['constructor'],
    );
    assert.equal((await (await s.call('/api/connection/use', { name: 'toString' })).json()).code, 'no_profile');
    assert.equal((await (await s.call('/api/connection/set', { name: '__proto__', config })).json()).code, 'bad_name');
  } finally {
    await s.stop();
  }
});

test('the standalone download serves the page it ships, with this start’s token, and builds nothing', async () => {
  const dataDir = tempDir();
  const pageFile = join(dataDir, 'page.html');
  writeFileSync(pageFile, '<!doctype html><title>shipped</title><script>window.SHIPPED=1</script>');
  const s = await openServer({ dataDir, pageFile });
  try {
    assert.match(await (await fetch(s.url)).text(), /window\.DR_SERVER_TOKEN="[0-9a-f]{64}";window\.SHIPPED=1/);
  } finally {
    await s.stop();
  }
});

test('a download missing its page says so before it creates anything', async () => {
  const root = tempDir();
  const dataDir = join(root, 'data');
  try {
    await assert.rejects(
      openServer({ dataDir, pageFile: join(dataDir, 'gone.html') }),
      /Download the standalone zip again/,
    );
    assert.equal(existsSync(dataDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the update check: the newest release and its standalone zip, and nothing offline', async () => {
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const [major, minor] = version.split('.').map(Number);
  const tag = `v${major}.${minor + 1}.0`;
  const zip = `dice-roguelife-standalone-${tag.replaceAll('.', '_')}.zip`;
  let reply = () =>
    Response.json({
      tag_name: tag,
      html_url: 'https://github.com/release-page',
      assets: [
        { name: 'dice-roguelife.html', browser_download_url: 'https://github.com/page' },
        { name: zip, browser_download_url: 'javascript:alert(1)' },
      ],
    });
  const s = await openServer({ fetcher: async () => reply() });
  const check = async () => (await s.call('/api/update', {})).json();
  try {
    assert.deepEqual(await check(), {
      latest: tag.slice(1),
      newer: true,
      // built here from the version, whatever the reply says
      url: `https://github.com/wonjoonSeol-WS/dice-roguelife/releases/download/${tag}/${zip}`,
      dataPath: s.dataDir,
    });
    reply = () => Response.json({ tag_name: 'v' + version, assets: [] });
    assert.equal((await check()).newer, false);
    reply = () => Response.json({ tag_name: tag, assets: [] }); // a release without the zip: its page
    assert.equal((await check()).url, `https://github.com/wonjoonSeol-WS/dice-roguelife/releases/tag/${tag}`);
    reply = () => {
      throw new TypeError('fetch failed');
    };
    assert.deepEqual(await check(), { latest: null, newer: false, url: null, dataPath: s.dataDir });
  } finally {
    await s.stop();
  }
});

test('an update copies the data and config.json older versions kept in the app folder, once', () => {
  const from = tempDir();
  const root = tempDir();
  const home = join(root, 'home');
  try {
    mkdirSync(join(from, 'data', 'assets'), { recursive: true });
    writeFileSync(join(from, 'data', 'dice-roguelife.db'), 'db');
    writeFileSync(join(from, 'data', 'connection.json'), '{}');
    const config = { port: 3100, dataDir: 'data', hosts: ['my-pc.tail1234.ts.net'] };
    writeFileSync(join(from, 'config.json'), JSON.stringify(config));
    assert.deepEqual(adoptOldData(home, from), [join(from, 'data'), join(from, 'config.json')]);
    assert.equal(readFileSync(join(home, 'dice-roguelife.db'), 'utf8'), 'db');
    assert.ok(existsSync(join(home, 'connection.json')) && existsSync(join(home, 'assets')));
    // the old default folder came along, so the copy needs no dataDir
    const copied = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    assert.deepEqual(copied, { port: 3100, hosts: ['my-pc.tail1234.ts.net'] });
    assert.deepEqual(adoptOldData(home, from), []);
  } finally {
    rmSync(from, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
