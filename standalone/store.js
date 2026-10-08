// What the standalone keeps on disk: the game's documents in one SQLite file (Node's built-in node:sqlite), behaving
// like memDB in src/js/db.js, the image files, and the AI connection (connection.json, the API key included).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiError } from './relay.js';

const FIELD = /^\w+$/;
const OPS = { '==': '=', '<': '<', '>': '>', '<=': '<=', '>=': '>=' };
const ID = /^[\w-]{1,64}$/;

function checkPath(path, isDoc) {
  const parts = typeof path === 'string' ? path.split('/') : [];
  if (!parts.length || parts.some(p => !p || p === '.' || p === '..') || (parts.length % 2 === 0) !== isDoc)
    throw apiError('invalid_path', `Not a ${isDoc ? 'document' : 'collection'} path: ${path}`);
  return path;
}
// node:sqlite binds numbers and strings; the game only compares those
function bindable(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  throw apiError('invalid_query', 'Only numbers and strings can be compared.');
}
// a document's top-level plain values, which queries read instead of parsing the whole (often large) document
const metaOf = data =>
  JSON.stringify(Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v !== 'object')));
// writes a file whole or not at all
export function writeAtomic(path, bytes, mode) {
  writeFileSync(path + '.tmp', bytes, { mode });
  renameSync(path + '.tmp', path);
}
// a JSON file, or fallback when there is none; a damaged one throws rather than being replaced by the fallback
export function readJsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

export function openStore(dir) {
  const files = join(dir, 'assets');
  const connectionFile = join(dir, 'connection.json');
  mkdirSync(files, { recursive: true });
  const db = new DatabaseSync(join(dir, 'dice-roguelife.db'));
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, parent TEXT NOT NULL, meta TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS docs_parent ON docs (parent);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, created TEXT NOT NULL);`);
  const getDoc = db.prepare('SELECT data FROM docs WHERE path = ?');
  const putDoc = db.prepare('INSERT OR REPLACE INTO docs (path, parent, meta, data) VALUES (?, ?, ?, ?)');
  const delDoc = db.prepare('DELETE FROM docs WHERE path = ?');
  const write = (path, data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw apiError('invalid_data', 'A document is an object.');
    putDoc.run(path, path.slice(0, path.lastIndexOf('/')), metaOf(data), JSON.stringify(data));
  };

  // one request from the page: op (get, set, delete, add, query) on path, with data or a query
  function docOp({ op, path, data, where = [], order = null, limit = 1000 }) {
    switch (op) {
      case 'get': {
        const row = getDoc.get(checkPath(path, true));
        return { exists: !!row, data: row ? JSON.parse(row.data) : undefined };
      }
      case 'set':
        write(checkPath(path, true), data);
        return {};
      case 'delete':
        delDoc.run(checkPath(path, true));
        return {};
      case 'add': {
        const id = randomUUID();
        write(checkPath(path, false) + '/' + id, data);
        return { id };
      }
      case 'query': {
        let sql = 'SELECT path, data FROM docs WHERE parent = ?';
        const args = [checkPath(path, false)];
        for (const [field, cmp, value] of where) {
          if (!FIELD.test(field) || !OPS[cmp]) throw apiError('invalid_query', 'Unsupported condition.');
          sql += ` AND json_extract(meta, '$.${field}') ${OPS[cmp]} ?`;
          args.push(bindable(value));
        }
        if (order) {
          if (!FIELD.test(order[0])) throw apiError('invalid_query', 'Unsupported order.');
          sql += ` ORDER BY json_extract(meta, '$.${order[0]}') ${order[1] === 'desc' ? 'DESC' : 'ASC'}`;
        }
        sql += ' LIMIT ?';
        args.push(Math.max(0, Math.min(Number(limit) || 0, 10000)));
        const docs = db
          .prepare(sql)
          .all(...args)
          .map(r => ({ id: r.path.slice(r.path.lastIndexOf('/') + 1), data: JSON.parse(r.data) }));
        return { docs };
      }
      default:
        throw apiError('invalid_query', 'Unknown operation.');
    }
  }

  const addAsset = db.prepare('INSERT INTO assets (id, type, size, created) VALUES (?, ?, ?, ?)');
  const getAsset = db.prepare('SELECT type FROM assets WHERE id = ?');
  const listAssets = db.prepare('SELECT id, type AS contentType, size, created AS createdAt FROM assets');
  const delAsset = db.prepare('DELETE FROM assets WHERE id = ?');
  const assets = {
    add(bytes, type) {
      const id = randomUUID();
      writeAtomic(join(files, id), bytes);
      addAsset.run(id, type, bytes.length, new Date().toISOString());
      return id;
    },
    // { type, file } or null
    get(id) {
      const row = ID.test(id) && getAsset.get(id);
      return row ? { type: row.type, file: join(files, id) } : null;
    },
    list: () => listAssets.all(),
    delete(id) {
      if (!ID.test(id)) return;
      delAsset.run(id);
      rmSync(join(files, id), { force: true });
    },
  };

  // the AI connection profiles: { active, profiles: { name: { config, apiKey } } }, kept apart from the game's documents
  // so saves and exports never hold a key
  const connection = {
    get: () => readJsonFile(connectionFile, { active: '', profiles: {} }),
    set: value => writeAtomic(connectionFile, JSON.stringify(value, null, 2), 0o600), // only this user may read the keys
  };

  return { docOp, assets, connection, close: () => db.close() };
}
