// Uploading many pictures at once: none is lost from the list, a rate-limited upload is retried, and the same files sent
// again are skipped. The database is slowed down so writes of the same page overlap the way they would live.
import { test, expect } from './support/test.js';
import { claudeMock } from './support/harness.js';

const N = 60;

// a file store whose uploads take a moment (and can fail), and a database whose index writes take a moment
const BEFORE = String.raw`
window.__up={n:0,live:0,max:0,calls:0,failFirst:0};
window.__idxWrites=0;
const __origUse=null;
`;

function hook(fail) {
  return String.raw`
(()=>{
  const base=window.claude.use;
  window.claude.use=async n=>{
    if(n==='assets')return{
      upload:async(blob,o)=>{
        const u=window.__up;u.calls++;u.live++;u.max=Math.max(u.max,u.live);
        await new Promise(r=>setTimeout(r,20+Math.random()*40));
        u.live--;
        if(u.calls<=${fail}){const e=new Error('slow down');e.code='rate_limited';throw e}
        return{id:'a'+(++u.n)};
      },
      list:async()=>({assets:[],files:0,usage:{files:0,maxFiles:5000,bytes:0,maxBytes:1e9}}),
      delete:async()=>{}
    };
    return base(n);
  };
})();
`;
}

// N distinct small png files, named as scenes so no set questions are asked
const MAKE = String.raw`async(n,tag)=>{
  const files=[];
  for(let i=0;i<n;i++){
    const cv=document.createElement('canvas');cv.width=cv.height=8;
    const c=cv.getContext('2d');c.fillStyle='hsl('+(i*6)+',70%,50%)';c.fillRect(0,0,8,8);
    c.fillStyle='#000';c.fillRect(i%8,(i*3)%8,2,2);
    const b=await new Promise(r=>cv.toBlob(r,'image/png'));
    files.push(new File([b],'bg_'+tag+i+'_day.png',{type:'image/png'}));
  }
  const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));
  const inp=document.querySelector('#upl');inp.files=dt.files;inp.dispatchEvent(new Event('change'));
}`;

async function setup(game, fail = 0) {
  const { pg, errs } = await game(claudeMock(undefined, { before: BEFORE }), { size: [900, 900] });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate(hook(fail));
  await pg.evaluate(() => {
    // the page already holds its capability handles; reconnect the file store through the patched use()
    return window.claude.use('assets').then(a => {
      DR.platform.assets = a;
    });
  });
  await pg.evaluate(() => {
    // every write of an index page takes a moment, so writes of the same page overlap while pictures keep landing
    const db = window.__dbmock;
    const orig = db.doc;
    db.doc = p => {
      const d = orig(p);
      if (String(p).startsWith('imgidx/')) {
        const set = d.set;
        d.set = async x => {
          window.__idxWrites++;
          window.__idxLive = (window.__idxLive || 0) + 1;
          window.__idxMax = Math.max(window.__idxMax || 0, window.__idxLive);
          await new Promise(r => setTimeout(r, 150));
          window.__idxLive--;
          return set.call(d, x);
        };
      }
      return d;
    };
    DR.platform.limits = Object.assign({}, DR.platform.limits, { images: true });
  });
  await pg.click('[data-tab="images"]');
  await pg.waitForSelector('#upl', { state: 'attached' });
  return { pg, errs };
}

async function indexed(pg) {
  // every picture the database's index pages hold
  return pg.evaluate(async () => {
    const q = await DR.platform.shared.collection('imgidx').get();
    return q.docs.flatMap(d => (d.data().rows || []).map(r => r.id));
  });
}

test('sixty pictures sent three at a time all land in the list', async ({ game }) => {
  const { pg, errs } = await setup(game);
  await pg.evaluate(`(${MAKE})(${N},'p')`);
  await pg.waitForFunction(`DR.app.images.length===${N}`, null, { timeout: 60000 });
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
  const ids = await indexed(pg);
  expect(ids.length, 'rows in the database index').toBe(N);
  expect(new Set(ids).size, 'distinct rows').toBe(N);
  const mem = await pg.evaluate(() => DR.app.images.map(x => x.id));
  expect(new Set(mem).size).toBe(N);
  expect([...new Set(mem)].sort()).toEqual([...new Set(ids)].sort());
  const s = await pg.evaluate(() => ({ max: window.__up.max, writes: window.__idxWrites, live: window.__idxMax }));
  const pages = await pg.evaluate(async () => (await DR.platform.shared.collection('imgidx').get()).docs.length);
  expect(pages, 'each of the three lanes fills its own page').toBe(3);
  expect(s.live, 'writes of different pages overlap').toBeGreaterThan(1);
  expect(s.max, 'uploads at the same time').toBeGreaterThan(1);
  expect(s.max).toBeLessThanOrEqual(3);
  expect(s.writes, 'index writes are shared between pictures that land together').toBeLessThan(N);
  console.log('uploads at once:', s.max, '| index writes:', s.writes, 'for', N, 'pictures');
  expect(errs).toEqual([]);
});

test('an upload that is rate limited is retried and nothing is lost', async ({ game }) => {
  const { pg, errs } = await setup(game, 4);
  await pg.evaluate(`(${MAKE})(24,'r')`);
  await pg.waitForFunction('DR.app.images.length===24', null, { timeout: 90000 });
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
  expect((await indexed(pg)).length).toBe(24);
  expect(await pg.evaluate(() => window.__up.calls), 'calls include the retries').toBeGreaterThan(24);
  expect(errs).toEqual([]);
});

test('the same files sent again are skipped', async ({ game }) => {
  const { pg, errs } = await setup(game);
  await pg.evaluate(`(${MAKE})(12,'s')`);
  await pg.waitForFunction('DR.app.images.length===12', null, { timeout: 60000 });
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
  const before = await pg.evaluate(() => window.__up.calls);
  await pg.evaluate(`(${MAKE})(12,'s')`);
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
  await pg.waitForTimeout(500);
  expect(await pg.evaluate(() => DR.app.images.length)).toBe(12);
  expect(await pg.evaluate(() => window.__up.calls), 'no new uploads').toBe(before);
  expect(errs).toEqual([]);
});

test('when the list cannot be saved, those pictures are reported and nothing half-saved stays', async ({ game }) => {
  const { pg, errs } = await setup(game);
  // the database refuses index writes after the first few (storage full)
  await pg.evaluate(() => {
    const db = window.__dbmock;
    const orig = db.doc;
    let writes = 0;
    db.doc = p => {
      const d = orig(p);
      if (String(p).startsWith('imgidx/')) {
        const set = d.set;
        d.set = async x => {
          if (++writes > 3) {
            const e = new Error('full');
            e.code = 'quota_exceeded';
            throw e;
          }
          return set.call(d, x);
        };
      }
      return d;
    };
  });
  await pg.evaluate(`(${MAKE})(30,'q')`);
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 60000 });
  await pg.waitForTimeout(500);
  const mem = await pg.evaluate(() => DR.app.images.map(x => x.id));
  const ids = await indexed(pg);
  expect(new Set(mem).size, 'no duplicates in memory').toBe(mem.length);
  expect([...mem].sort(), 'what the library shows is exactly what the database holds').toEqual([...ids].sort());
  expect(mem.length, 'some pictures were not saved').toBeLessThan(30);
  expect(errs).toEqual([]);
});

// names made of shadow_{style}_{gender}_... keep their own set (they used to merge into shadow_other)
const NAMES = String.raw`async(names)=>{
  const files=[];
  for(let i=0;i<names.length;i++){
    const cv=document.createElement('canvas');cv.width=cv.height=8;
    const c=cv.getContext('2d');c.fillStyle='hsl('+(i*50)+',70%,50%)';c.fillRect(0,0,8,8);
    const b=await new Promise(r=>cv.toBlob(r,'image/png'));
    files.push(new File([b],names[i],{type:'image/png'}));
  }
  const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));
  const inp=document.querySelector('#upl');inp.files=dt.files;inp.dispatchEvent(new Event('change'));
}`;

test('shadow pictures with a style word keep their own set and gender', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const names = [
    'shadow_cyber_male_neutral.png',
    'shadow_cyber_female_neutral.png',
    'shadow_male_neutral.png',
    'shadow_female_neutral_2.png',
  ];
  await pg.evaluate(`(${NAMES})(${JSON.stringify(names)})`);
  await pg.waitForFunction('DR.app.images.length===4', null, { timeout: 30000 });
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
  const got = await pg.evaluate(() =>
    Object.fromEntries(DR.app.images.map(x => [x.file, { set: x.set, emotion: x.emotion, variant: x.variant }])),
  );
  expect(got['shadow_cyber_male_neutral.png']).toMatchObject({ set: 'shadow_cyber_male', emotion: 'neutral' });
  expect(got['shadow_cyber_female_neutral.png']).toMatchObject({ set: 'shadow_cyber_female', emotion: 'neutral' });
  expect(got['shadow_male_neutral.png']).toMatchObject({ set: 'shadow_male' });
  expect(got['shadow_female_neutral_2.png']).toMatchObject({ set: 'shadow_female', variant: '2' });
  const meta = await pg.evaluate(() => DR.app.setMeta);
  expect(meta.shadow_cyber_male).toMatchObject({ gender: 'male', tier: 'generic' });
  expect(meta.shadow_cyber_female).toMatchObject({ gender: 'female', tier: 'generic' });
  expect(meta.shadow_other, 'nothing is merged into shadow_other').toBeUndefined();
  expect(errs).toEqual([]);
});

// 중복 정리 also finds the same picture stored twice (compressed again, other name), but not a picture where only a
// small area differs (a face with another expression, a blush). Drawn at 720x480: small pictures keep codec noise
// through the shrink to the signature; real ones don't.
const PICS = String.raw`async()=>{
  const draw=(extra)=>{
    const cv=document.createElement('canvas');cv.width=720;cv.height=480;const c=cv.getContext('2d');c.scale(3,3);
    c.fillStyle='#202428';c.fillRect(0,0,240,160);
    const g=c.createLinearGradient(0,0,240,160);g.addColorStop(0,'#335577');g.addColorStop(1,'#aa6644');c.fillStyle=g;c.fillRect(20,20,200,120);
    c.fillStyle='#e8d0a8';c.beginPath();c.arc(120,70,34,0,7);c.fill();
    c.fillStyle='#202428';c.fillRect(100,60,8,4);c.fillRect(132,60,8,4);c.fillRect(108,86,24,3);
    if(extra)extra(c);
    return cv;
  };
  const blob=(cv,t,q)=>new Promise(r=>cv.toBlob(r,t,q));
  const A=draw();
  const files=[
    new File([await blob(A,'image/png')],'bg_alpha_day.png',{type:'image/png'}),
    new File([await blob(A,'image/webp',0.8)],'bg_alpha-copy_day.webp',{type:'image/webp'}),
    new File([await blob(draw(c=>{c.fillStyle='#ffffff';c.fillRect(100,56,16,10);c.fillRect(124,56,16,10)}),'image/png')],'bg_alpha-eyes_day.png',{type:'image/png'}),
    new File([await blob(draw(c=>{c.fillStyle='rgba(230,110,120,0.45)';c.beginPath();c.ellipse(103,76,7,4,0,0,7);c.ellipse(137,76,7,4,0,0,7);c.fill()}),'image/png')],'bg_alpha-blush_day.png',{type:'image/png'}),
    new File([await blob(draw(c=>{c.fillStyle='#884422';c.fillRect(0,0,240,160);c.fillStyle='#ffee88';c.fillRect(30,100,180,40)}),'image/png')],'bg_other_day.png',{type:'image/png'}),
  ];
  const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));
  const inp=document.querySelector('#upl');inp.files=dt.files;inp.dispatchEvent(new Event('change'));
}`;

test('중복 정리 finds a recompressed copy but not a picture with only a small change', async ({ game }) => {
  const { pg, errs } = await setup(game);
  // the file store keeps the pictures so they can be read back
  await pg.evaluate(() => {
    window.__blobs = {};
    const up = DR.platform.assets.upload;
    DR.platform.assets.upload = async (blob, o) => {
      const r = await up(blob, o);
      window.__blobs[r.id] = blob;
      return r;
    };
    const f = window.fetch;
    window.fetch = (u, ...a) =>
      String(u).startsWith('/_blob/') ? Promise.resolve(new Response(window.__blobs[String(u).slice(7)])) : f(u, ...a);
  });
  await pg.evaluate(`(${PICS})()`);
  await pg.waitForFunction('DR.app.images.length===5', null, { timeout: 30000 });
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
  // the same stored file twice (uploads refuse that now, older libraries may hold it)
  await pg.evaluate(() => {
    const x = DR.app.images.find(i => i.file === 'bg_other_day.png');
    window.__blobs['dup-id'] = window.__blobs[x.id];
    DR.app.images.push({ ...x, id: 'dup-id', file: 'bg_other-dup_day.png', createdAt: '2999-01-01T00:00:00.000Z' });
  });
  await pg.click('#dedupe');
  await pg.waitForSelector('.review-list', { timeout: 30000 });
  const rows = await pg.$$eval('.review-item', els =>
    els.map(e => ({
      text: e.textContent,
      on: e.querySelector('input').checked,
      pics: e.querySelectorAll('img').length,
    })),
  );
  expect(rows.length, 'the same file and the recompressed copy, nothing else').toBe(2);
  expect(rows[0].text).toContain('other-dup');
  expect(rows[0].on, 'the same stored file starts checked').toBe(true);
  expect(rows[1].text).toContain('alpha-copy');
  expect(rows[1].text).toContain('비슷한 그림');
  expect(rows[1].on, 'a look-alike waits for the player').toBe(false);
  expect(rows[1].pics, 'both pictures are shown').toBe(2);
  await pg.locator('.review-item').nth(1).locator('img').first().dispatchEvent('click');
  expect(await pg.locator('.review-check').nth(1).isChecked(), 'a tap on a picture does not tick its row').toBe(false);
  expect(await pg.locator('.review-pic.big').count(), 'it enlarges the picture').toBe(1);
  await pg.click('#rvNo');
  expect(await pg.evaluate(() => DR.app.images.length), 'cancel keeps everything').toBe(6);
  expect(errs).toEqual([]);
});

// editing tags or picking a cover while pictures are still being sent must not stop the upload
test('editing during an upload does not stop it', async ({ game }) => {
  const { pg, errs } = await setup(game);
  // a set with three frames first, so there is a cover to pick
  await pg.evaluate(`(${NAMES})(['zed_smile.png','zed_joy.png','zed_anger.png'])`);
  await pg.waitForFunction('DR.app.images.length===3', null, { timeout: 30000 });
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
  await pg.evaluate(`(${MAKE})(45,'e')`);
  await pg.waitForFunction('DR.app.images.length>=12', null, { timeout: 30000 });
  const statBefore = await pg.evaluate(() => document.querySelector('#uplStat').textContent);
  // pick a cover (re-renders the tab) and edit a tag in the middle of the upload
  await pg.click('[data-cover]');
  await pg.waitForTimeout(300);
  const statAfterCover = await pg.evaluate(() => document.querySelector('#uplStat').textContent);
  const tag = pg.locator('.img [data-f="tags"]').first();
  await tag.fill('night, rain');
  await tag.dispatchEvent('change');
  await pg.waitForTimeout(300);
  await pg.waitForFunction('DR.app.images.length===48', null, { timeout: 60000 });
  // the progress text is a new empty element after the re-render: wait for the list itself to be complete
  await expect.poll(async () => (await indexed(pg)).length, { timeout: 30000 }).toBe(48);
  const ids = await indexed(pg);
  console.log(
    'status shown before:',
    JSON.stringify(statBefore),
    '| after the cover pick:',
    JSON.stringify(statAfterCover),
  );
  expect(ids.length, 'every picture is in the saved list').toBe(48);
  expect(statAfterCover, 'the progress text is still shown after the tab re-rendered').not.toBe('');
  expect(errs).toEqual([]);
});

// a second upload started while one is running is refused (it would send the same pictures twice)
test('a second upload while one is running is refused', async ({ game }) => {
  const { pg, errs } = await setup(game);
  await pg.evaluate(`(${MAKE})(30,'w')`);
  await pg.waitForFunction('window.__up.calls>=3', null, { timeout: 30000 });
  // the same files again, in the middle of the first upload
  await pg.evaluate(`(${MAKE})(30,'w')`);
  await pg.waitForFunction('DR.app.images.length===30', null, { timeout: 60000 });
  await expect.poll(async () => (await indexed(pg)).length, { timeout: 30000 }).toBe(30);
  await pg.waitForTimeout(500);
  expect(await pg.evaluate(() => DR.app.images.length), 'no picture was sent twice').toBe(30);
  expect(await pg.evaluate(() => window.__up.calls), 'each file was uploaded once').toBe(30);
  expect(errs).toEqual([]);
});

// 전체 삭제 removes the files side by side and leaves nothing behind
test('전체 삭제 deletes every file in parallel', async ({ game }) => {
  const { pg, errs } = await setup(game);
  await pg.evaluate(`(${MAKE})(24,'x')`);
  await pg.waitForFunction('DR.app.images.length===24', null, { timeout: 60000 });
  await expect.poll(async () => (await indexed(pg)).length, { timeout: 30000 }).toBe(24);
  await pg.evaluate(() => {
    const ids = DR.app.images.map(x => x.id);
    window.__deleted = [];
    window.__delLive = 0;
    window.__delMax = 0;
    DR.platform.assets.list = async () => ({
      assets: ids.map(id => ({ id })),
      usage: { files: ids.length, maxFiles: 5000, bytes: 0, maxBytes: 1e9 },
    });
    DR.platform.assets.delete = async id => {
      window.__delMax = Math.max(window.__delMax, ++window.__delLive);
      await new Promise(r => setTimeout(r, 40));
      window.__delLive--;
      window.__deleted.push(id);
    };
    DR.mock('askConfirm', async () => true);
    DR.mock('askPrompt', async () => String(ids.length));
  });
  const t0 = Date.now();
  await pg.click('#wipeAll');
  await pg.waitForFunction('DR.app.images.length===0', null, { timeout: 30000 });
  const took = Date.now() - t0;
  expect(await pg.evaluate(() => window.__deleted.length), 'every file deleted').toBe(24);
  expect(await pg.evaluate(() => window.__delMax), 'deletes overlap').toBeGreaterThan(1);
  expect(took, 'faster than one by one (24 x 40ms)').toBeLessThan(900);
  expect((await indexed(pg)).length, 'the list is empty too').toBe(0);
  expect(errs).toEqual([]);
});

// 중복 정리 applied: the copy is gone from the files, the library and the saved list
test('중복 정리 applied leaves the library and the saved list in step', async ({ game }) => {
  const { pg, errs } = await setup(game);
  await pg.evaluate(() => {
    window.__blobs = {};
    window.__gone = [];
    const up = DR.platform.assets.upload;
    DR.platform.assets.upload = async (blob, o) => {
      const r = await up(blob, o);
      window.__blobs[r.id] = blob;
      return r;
    };
    DR.platform.assets.delete = async id => {
      window.__gone.push(id);
    };
    const f = window.fetch;
    window.fetch = (u, ...a) =>
      String(u).startsWith('/_blob/') ? Promise.resolve(new Response(window.__blobs[String(u).slice(7)])) : f(u, ...a);
  });
  await pg.evaluate(`(${PICS})()`);
  await pg.waitForFunction('DR.app.images.length===5', null, { timeout: 30000 });
  await expect.poll(async () => (await indexed(pg)).length, { timeout: 30000 }).toBe(5);
  // Apply as offered: the look-alike starts unchecked, so nothing goes
  await pg.evaluate('window.__t=[];DR.toast=m=>window.__t.push(m);0');
  await pg.click('#dedupe');
  await pg.waitForSelector('.review-list', { timeout: 30000 });
  await pg.click('#rvOk');
  await expect.poll(() => pg.evaluate(() => window.__t), { timeout: 30000 }).toContain('지운 이미지가 없어요');
  expect(await pg.evaluate(() => DR.app.images.length)).toBe(5);
  await pg.click('#dedupe');
  await pg.waitForSelector('.review-list', { timeout: 30000 });
  await pg.click('#rvAll');
  await pg.click('#rvOk');
  await pg.waitForFunction('DR.app.images.length===4', null, { timeout: 30000 });
  const mem = await pg.evaluate(() => DR.app.images.map(x => x.file));
  // pictures sent side by side land in no fixed order, so either of the pair may be the one kept: exactly one is
  const pair = mem.filter(f => f === 'bg_alpha_day.png' || f === 'bg_alpha-copy_day.webp');
  expect(pair.length, 'one of the pair is left').toBe(1);
  expect(mem).toContain('bg_alpha-eyes_day.png');
  expect(mem).toContain('bg_alpha-blush_day.png');
  expect(mem).toContain('bg_other_day.png');
  await expect.poll(async () => (await indexed(pg)).length, { timeout: 30000 }).toBe(4);
  expect(await pg.evaluate(() => window.__gone.length)).toBe(1);
  expect(errs).toEqual([]);
});

// the select that merges two names was white with light text (unreadable in the dark theme)
test('the merge select has a dark background like the other selects', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const bg = await pg.evaluate(() => {
    const s = document.createElement('select');
    s.className = 'mem-merge-select';
    s.innerHTML = '<option>같은 사람과 합치기…</option>';
    document.body.appendChild(s);
    const cs = getComputedStyle(s);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  expect(bg.bg, 'not white').not.toBe('rgb(255, 255, 255)');
  expect(bg.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(errs).toEqual([]);
});
