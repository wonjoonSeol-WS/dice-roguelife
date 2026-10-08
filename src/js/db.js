/* ============ capabilities (light up when ready) ============ */
import { clone, toast, uid } from './util.js';
import { T } from './i18n.js';

// What the host (host.js) gave this page. boot (boot.js) fills it in once; everything else only reads it.
export const platform = {
  db: null, // the database: the artifact's own, or memDB when there is none
  sample: null, // calls Claude
  assets: null, // the image file store
  user: null, // who is playing
  limits: null, // what sample reports it allows (prompt bytes, images)
  shared: null, // the database that holds what every viewer shares (images, sets, hall, config)
  userPath: 'data/users/local', // where this player's own documents live
  userId: 'local',
  memMode: false, // no database at all: nothing survives a reload
  localMode: false, // a viewer who cannot write the database: saved in this browser only
};
let whitelist = []; // user ids the owner let in as privileged (config/whitelist)
export async function loadWhitelist() {
  try {
    const w = await platform.shared.doc('config/whitelist').get();
    whitelist = w.exists ? thaw(w.data()).uids || [] : [];
  } catch (e) {
    whitelist = [];
  }
}
// the owner, a whitelisted player, or anyone in a preview without a database: free setup and library upkeep are open
export async function isPrivileged() {
  if (platform.memMode) return true;
  if (whitelist.includes(platform.userId)) return true;
  try {
    return !!(platform.user && (await platform.user.isOwner()));
  } catch (e) {
    return false;
  }
}
export function memDB(persistKey) {
  // in-memory store; with persistKey it mirrors to localStorage (read-only viewers)
  const store = new Map();
  if (persistKey) {
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) store.set(k, v);
    } catch {
      // nothing usable stored: start empty
    }
  }
  let timer = null;
  const flush = () => {
    if (!persistKey) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(persistKey, JSON.stringify(Object.fromEntries(store)));
      } catch (e) {
        toast(T("This device's storage is full"), 4000);
      }
    }, 150);
  };
  const snap = p => ({
    id: p.split('/').pop(),
    exists: store.has(p),
    data: () => (store.has(p) ? clone(store.get(p)) : undefined),
  });
  const parity = (p, even) => {
    const n = p.split('/').filter(Boolean).length;
    if ((n % 2 === 0) !== even) throw new Error(`db path parity: "${p}" has ${n} segments`);
  };
  const doc = p => (
    parity(p, true),
    {
      path: p,
      id: p.split('/').pop(),
      get: async () => snap(p),
      set: async d => {
        store.set(p, clone(d));
        flush();
      },
      update: async d => {
        store.set(p, Object.assign(store.get(p) || {}, clone(d)));
        flush();
      },
      delete: async () => {
        store.delete(p);
        flush();
      },
    }
  );
  const q = (col, w = [], o = null, l = 1000) => (
    parity(col, false),
    {
      where: (f, op, v) => q(col, [...w, [f, op, v]], o, l),
      orderBy: (f, d = 'asc') => q(col, w, [f, d], l),
      limit: n => q(col, w, o, n),
      doc: id => doc(col + '/' + (id || uid())),
      add: async d => {
        const id = uid();
        store.set(col + '/' + id, clone(d));
        flush();
        return { id };
      },
      get: async () => {
        let docs = [...store.keys()]
          .filter(k => k.startsWith(col + '/') && !k.slice(col.length + 1).includes('/'))
          .map(snap);
        for (const [f, op, v] of w)
          docs = docs.filter(d => {
            const x = d.data()[f];
            return op === '=='
              ? x === v
              : op === '<='
                ? x <= v
                : op === '>='
                  ? x >= v
                  : op === '<'
                    ? x < v
                    : op === '>'
                      ? x > v
                      : true;
          });
        if (o) docs.sort((a, b) => (a.data()[o[0]] > b.data()[o[0]] ? 1 : -1) * (o[1] === 'desc' ? -1 : 1));
        docs = docs.slice(0, l);
        return { docs, size: docs.length, empty: !docs.length };
      },
    }
  );
  return { doc, collection: c => q(c) };
}
export const userDoc = p => platform.db.doc(`${platform.userPath}/${p}`);
export const userCol = p => platform.db.collection(`${platform.userPath}/${p}`);
// Z85 (ZeroMQ base85): no padding, an 85-character alphabet that is safe inside JSON. Raw gzip bytes in, text out; the byte count rides along so the zero padding can be dropped on the way back
const Z85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#';
export function z85enc(u8) {
  const n = u8.length,
    pad = (4 - (n % 4)) % 4;
  const b = new Uint8Array(n + pad);
  b.set(u8);
  let out = '';
  for (let i = 0; i < b.length; i += 4) {
    let v = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    let c = '';
    for (let k = 0; k < 5; k++) {
      c = Z85[v % 85] + c;
      v = Math.floor(v / 85);
    }
    out += c;
  }
  return { text: out, bytes: n };
}
export function z85dec(text, bytes) {
  const idx = {};
  for (let i = 0; i < 85; i++) idx[Z85[i]] = i;
  const out = new Uint8Array((text.length / 5) * 4);
  let o = 0;
  for (let i = 0; i < text.length; i += 5) {
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + idx[text[i + k]];
    out[o++] = (v >>> 24) & 255;
    out[o++] = (v >>> 16) & 255;
    out[o++] = (v >>> 8) & 255;
    out[o++] = v & 255;
  }
  return out.subarray(0, bytes);
}
export async function gzipBytes(obj) {
  if (!('CompressionStream' in window)) return null;
  const st = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
export async function gunzipBytes(u8) {
  const st = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(st).text());
}
async function zip(obj) {
  try {
    if (!('CompressionStream' in window)) return null;
    const st = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(st).arrayBuffer();
    let b = '';
    const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 8192) b += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    return btoa(b);
  } catch (e) {
    return null;
  }
}
async function unzip(str) {
  try {
    const bin = atob(str);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
    const st = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(st).text());
  } catch (e) {
    return null;
  }
}
export async function packTurn(t) {
  const d = Object.assign({}, t);
  if (d.out || d.snap) {
    const payload = { out: d.out, snap: d.snap };
    const z = await zip(payload);
    if (z && z.length < JSON.stringify(payload).length * 0.9) {
      d.z = z;
      delete d.out;
      delete d.snap;
    }
  }
  return d;
}
export async function inflate(list) {
  const out = [];
  for (const raw of list) {
    const d = thaw(raw);
    if (d.z) {
      const o = await unzip(d.z);
      if (o) {
        d.out = o.out;
        d.snap = o.snap;
      }
      delete d.z;
    }
    // the oldest turns kept their pictures on out
    if (!d.img && d.out && (d.out.scene_img || d.out.char_img)) {
      d.img = {};
      if (d.out.scene_img) d.img.scene = d.out.scene_img;
      if (d.out.char_img) d.img.char = d.out.char_img;
    }
    out.push(d);
  }
  return out;
}
export const thaw = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
// one of this player's documents, or null when it does not exist. A failed read throws: it must never pass for a
// missing document (that would start a save over, or write default settings over the real ones).
export async function dget(p) {
  const s = await userDoc(p).get();
  return s.exists ? thaw(s.data()) : null;
}
export async function dset(p, d) {
  await userDoc(p).set(d);
}
