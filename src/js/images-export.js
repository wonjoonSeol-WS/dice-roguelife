/* ============ image pack export: a zip of the library under canonical names, plus tags.json ============ */
import { noteIgnored, toast } from './util.js';
import { setStat } from './stat.js';
import { app } from './app.js';
import { useCapability } from './boot.js';
import { imgUrl, worldsOf } from './images.js';
import { logErr } from './diag.js';
import { T } from './i18n.js';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const TIMES = ['day', 'sunset', 'night', 'indoor'];

// one canonical file name per image (no extension): the same names the upload rules read back
function baseName(x) {
  if (x.kind === 'char') {
    const set = x.set || x.name || 'unnamed';
    return `${set}_${x.emotion || 'neutral'}${x.variant ? '_' + x.variant : ''}`;
  }
  if (x.kind === 'scene') return 'bg_' + String(x.name || x.file || x.id).replace(/^bg_/i, '');
  return String(x.name || (x.file || x.id).replace(/\.[^.]+$/, ''));
}
// names are unique inside the pack: a second "female1_smile" becomes "female1_smile_2"
function nameAll(imgs, extOf) {
  const used = new Set();
  return imgs.map(x => {
    const b = baseName(x).replace(/[\\/:*?"<>|]/g, '_');
    const ext = extOf(x);
    let n = 1,
      name = `${b}.${ext}`;
    while (used.has(name.toLowerCase())) name = `${b}_${++n}.${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// the tags.json the import button reads, keyed by the pack's file names
export function buildTagsJson(imgs, names) {
  const out = { sets: {}, images: {}, backgrounds: {} };
  imgs.forEach((x, i) => {
    const fn = names[i];
    const ws = worldsOf(x);
    if (x.kind === 'char') {
      const k = x.set || x.name;
      if (k && !out.sets[k]) {
        const m = app.setMeta[k] || {};
        const s = {};
        if (m.gender) s.gender = m.gender;
        const sw = worldsOf(m);
        if (sw.length) s.worlds = sw;
        if (m.role) s.role = m.role;
        if (m.tier) s.tier = m.tier;
        if (m.charName) s.name = m.charName;
        if (m.aliases && m.aliases.length) s.aliases = m.aliases;
        const cover = m.cover ? imgs.findIndex(y => y.id === m.cover) : -1;
        if (cover >= 0) s.cover = names[cover]; // by file name: ids are this install's
        out.sets[k] = s;
      }
      const e = { emotion: x.emotion || 'neutral', tags: x.tags || [] };
      if (ws.length) e.worlds = ws;
      out.images[fn] = e;
    } else if (x.kind === 'scene') {
      const parts = String(x.name || '').split('_');
      const time = TIMES.includes(parts[parts.length - 1]) ? parts.pop() : '';
      const e = { tags: x.tags || [] };
      if (parts.join('_')) e.place = parts.join('_');
      if (time) e.time = time;
      if (ws.length) e.worlds = ws;
      out.backgrounds[fn] = e;
    }
  });
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// a stored (uncompressed) zip: the pictures are already compressed, and the parts stay Blobs so memory stays small
export async function makeZip(files) {
  const parts = [],
    central = [];
  let offset = 0;
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const nm = enc.encode(f.name);
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // names are UTF-8
    h.setUint16(10, dosTime, true);
    h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true);
    parts.push(h.buffer, nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nm.length, true);
    c.setUint32(42, offset, true);
    central.push(c.buffer, nm);
    offset += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, p) => a + (p.byteLength || p.length), 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}

async function save(filename, blob) {
  const dl = await useCapability('downloads');
  if (!dl) {
    toast(T("This page can't save files. Open it from the published link"));
    return false;
  }
  await dl.save({ filename, data: blob });
  return true;
}

// withImages: the whole pack (pictures + tags.json); otherwise tags.json alone
export async function exportPack(withImages) {
  const say = t => {
    setStat(t);
  };
  const imgs = app.images.filter(x => x.kind === 'char' || x.kind === 'scene' || x.kind === 'fx');
  if (!imgs.length) {
    toast(T('No images to export'));
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (!withImages) {
      const names = nameAll(imgs, () => 'png');
      const json = JSON.stringify(buildTagsJson(imgs, names), null, 2);
      if (await save(`tags_${day}.json`, new Blob([json], { type: 'application/json' })))
        toast(T('Exported tags.json (file names match the names images were uploaded with)'), 4000);
      return;
    }
    const blobs = [];
    let skipped = 0;
    for (let i = 0; i < imgs.length; i++) {
      say(T('Downloading images {i}/{n}', { i: i + 1, n: imgs.length }));
      try {
        const r = await fetch(imgUrl(imgs[i].id));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        blobs.push(await r.blob());
      } catch (e) {
        noteIgnored('export pack: ' + imgs[i].id, e);
        blobs.push(null);
        skipped++;
      }
    }
    const have = imgs.filter((_, i) => blobs[i]);
    const haveBlobs = blobs.filter(Boolean);
    const names = nameAll(have, x => EXT[haveBlobs[have.indexOf(x)].type] || 'png');
    const json = JSON.stringify(buildTagsJson(have, names), null, 2);
    say(T('Building the zip'));
    const zip = await makeZip([
      ...have.map((_, i) => ({ name: names[i], blob: haveBlobs[i] })),
      { name: 'tags.json', blob: new Blob([json], { type: 'application/json' }) },
    ]);
    if (await save(`dice-roguelife-images_${day}.zip`, zip))
      toast(
        T('Exported {n} {n|image|images} and tags.json as a zip ({mb}MB)', {
          n: have.length,
          mb: (zip.size / 1048576).toFixed(1),
        }) + (skipped ? T(', skipped {n} that could not be downloaded', { n: skipped }) : ''),
        5000,
      );
  } catch (e) {
    if (e && e.code === 'declined') toast(T('Cancelled'));
    else {
      logErr('export-pack', e);
      toast(T('Export failed: {err}', { err: (e && (e.code || e.message)) || e }), 5000);
    }
  } finally {
    say('');
  }
}
