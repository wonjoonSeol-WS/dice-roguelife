// The host adapter for the standalone page (the contract is in src/js/host.js): saves, images and the AI connection
// live on the local server (../server.js), and narration goes through its relay. It registers itself on load, so
// main.js imports it before the game.
import { registerHost } from '../../src/js/host.js';
import { clone, uid } from '../../src/js/util.js';
import { post } from './net.js';
import { loadConnection, sample } from './providers.js';
import { bindProviderSettings, syncBanner } from './settings.js';

const dbCall = body => post('/api/db', body);

// documents: the same shapes as memDB (src/js/db.js)
const snap = (id, exists, value) => ({ id, exists, data: () => (exists ? clone(value) : undefined) });
function doc(path) {
  const id = path.split('/').pop();
  return {
    id,
    get: async () => {
      const r = await dbCall({ op: 'get', path });
      return snap(id, r.exists, r.data);
    },
    set: data => dbCall({ op: 'set', path, data }),
    delete: () => dbCall({ op: 'delete', path }),
  };
}
function collection(path, where = [], order = null, limit = 1000) {
  return {
    where: (field, op, value) => collection(path, [...where, [field, op, value]], order, limit),
    orderBy: (field, dir = 'asc') => collection(path, where, [field, dir], limit),
    limit: n => collection(path, where, order, n),
    doc: id => doc(path + '/' + (id || uid())),
    add: data => dbCall({ op: 'add', path, data }),
    get: async () => {
      const r = await dbCall({ op: 'query', path, where, order, limit });
      const docs = r.docs.map(d => snap(d.id, true, d.data));
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}

const assets = {
  upload: (blob, { type } = {}) => post('/api/assets/upload', blob, { type: type || blob.type }),
  // the disk's free space is the byte limit
  list: async () => {
    const { files, free } = await post('/api/assets/list', {});
    const bytes = files.reduce((n, f) => n + f.size, 0);
    return { assets: files, usage: { bytes, files: files.length, maxFiles: 50000, maxBytes: bytes + free } };
  },
  delete: id => post('/api/assets/delete', { id }),
};

const downloads = {
  save: async ({ filename, data }) => {
    const url = URL.createObjectURL(data),
      a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { status: 'saved' };
  },
};

registerHost({
  id: 'standalone',
  available: () => !!window.DR_SERVER_TOKEN,
  assetUrl: id => '/assets/' + id,
  bindSettings: bindProviderSettings,
  connect: async capability => {
    if (capability === 'db') return { doc, collection };
    if (capability === 'assets') return assets;
    if (capability === 'downloads') return downloads;
    if (capability === 'user') return { id: async () => 'local', isOwner: async () => true, can: async () => true };
    if (capability === 'sample') {
      await loadConnection();
      syncBanner();
      return sample;
    }
    return null;
  },
});
