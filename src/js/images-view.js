/* ============ images view ============ */
import { $, esc, inParallel, noteIgnored, nowIso, sha256Hex, toast } from './util.js';
import { EMOS, WORLDS } from './data.js';
import { platform } from './db.js';
import { app } from './app.js';
import { saveSettings } from './settings.js';
import { logErr } from './diag.js';
import { answerDialog, askConfirm, askPrompt, askReview, openDialog, openSheet } from './sheet.js';
import { fillHashes, findManifestAsset, IMGDOC, imgError, IMGX, restoreFromManifest, SETDOC } from './library.js';
import { charSetsAll, genderOf, imgById, imgUrl, setCover, setWorlds, worldChips, worldsOf } from './images.js';
import { capTags, isGeneric, isIdTag, setIds, setTier, TIERS_CAST, toEnglishTags } from './casting.js';
import { exportPack } from './images-export.js';
import { setStat, statText } from './stat.js';
import { groupSimilar, similar, visualSig } from './image-sim.js';
import { persist } from './persistence.js';
import { fillTemplate, pr } from './prompt.js';
import { N_, T } from './i18n.js';
import { GENDER, GENDER_LABEL } from './enums.js';

let imgFilter = 'all';
export async function renderImages() {
  const box = $('#imgBox');
  if (!box.dataset.zoom) {
    box.dataset.zoom = '1';
    box.addEventListener('click', e => {
      const t = e.target.closest('[data-big]');
      if (t) showBigImage(t.dataset.big, t.dataset.cap);
    });
  }
  if (!platform.assets) {
    box.innerHTML = `<h3 class="view-title img-off-title">${T('Images')}</h3><p class="muted">${T("Only this app's owner can upload images. Open it from the published link.")}</p>`;
    return;
  }
  let usage = null;
  try {
    usage = (await platform.assets.list()).usage;
  } catch (e) {
    noteIgnored('images-view: asset usage', e);
  }
  const canAuto = platform.limits && platform.limits.images;
  const sets = charSetsAll();
  const orphan = usage ? Math.max(0, usage.files - app.images.length) : 0;
  box.innerHTML =
    imagesHeaderHtml(usage, orphan, canAuto) + '\n' + setsSectionHtml(sets) + '\n' + allImagesSectionHtml();
  bindImagesToolbar(box);
  box.querySelectorAll('[data-set]').forEach(bindSetCard);
  bindImgGrid();
}

// the top of the tab: notices, the guide, storage use and the action buttons
function imagesHeaderHtml(usage, orphan, canAuto) {
  return `<h3 class="view-title">${T('Images')}</h3>
   ${imgError ? `<div class="notice img-notice">${T("Couldn't read the image list ({error}). Try reloading.", { error: esc(imgError) })}</div>` : ''}
   ${orphan > 0 ? `<div class="notice img-notice">${T('Storage holds {files} images but the list has only {listed}.', { files: usage.files, listed: app.images.length })} <button class="btn inline-action" id="recover">${T('Recover the list')}</button></div>` : ''}
   <details class="odds guide img-guide"><summary>${T('Help: tags and file names')}</summary>
      <p>${T('<b>There are two kinds of tags</b>, with one rule: proper nouns stay in their own language, everything else is English.')}</p>
      <div class="g"><code>${T('Looks')}</code><span>${T('English. <code>black hair</code>, <code>armor</code>. The narrator describes looks in English and the code compares word by word. Korean is turned into English when saved; English only gets its spelling fixed.')}</span><code>${T('Identity')}</code><span>${T('<code>key:value</code>. The key is English (<code>faction</code>, <code>company</code>, any word), the value is a proper noun in its own language (<code>faction:Tang Clan</code>, <code>company:Nintendo</code>). It is compared as is, never translated. It must be on every frame of a set, so add it on the set card; "Find faction tags" pulls them from descriptions.')}</span></div>
      <p>${T("<b>File name rules</b> (you'll be asked when a name doesn't fit)")}</p>
      <div class="g"><code>{set}_{emotion}</code><span>${T('Character. <code>female1_smile.png</code>. A set is one person with several expressions.')}</span><code>shadow_{gender}</code><span>${T('Silhouette for extras. <code>shadow_male_neutral.png</code>, <code>shadow_female_2.png</code>. Grouped into a set per gender')}</span><code>bg_{place}_{time}</code><span>${T('Background. <code>bg_tavern_night.png</code>')}</span><code>admin_{emotion}</code><span>${T('Game master')}</span><code>dice</code><span>${T('Dice effect. <code>dice</code>, <code>dice_success</code>, <code>dice_fail</code>. Needs no labels and auto-sort skips it')}</span></div>
      <p>${T('Uploading the same file again skips it.')}</p>
    </details>
   ${usage ? `<div class="img-usage"><div class="row img-usage-head"><span>${T('{files} / {max} files', { files: usage.files, max: usage.maxFiles })}</span><span>${(usage.bytes / 1048576).toFixed(1)} / ${(usage.maxBytes / 1048576).toFixed(0)} MB</span></div><div class="meter"><i style="width:${Math.min(100, (usage.bytes / usage.maxBytes) * 100)}%"></i></div></div>` : ''}
   <div class="row img-toolbar"><label class="btn primary file-btn">${T('Upload images')}<input type="file" id="upl" accept="image/*" multiple hidden></label>
    <label class="btn file-btn">${T('Import tags.json')}<input type="file" id="tagsIn" accept=".json,application/json" hidden></label>
    ${canAuto && platform.sample ? `<button class="btn" id="autoTag">${T('Auto-sort')}</button>` : ''}<button class="btn" id="dedupe">${T('Clean up duplicates')}</button><button class="btn" id="expPack" title="${T('Download a zip of the images under their upload names, with tags.json')}">${T('Export pack')}</button><button class="btn" id="expTags" title="${T('Download tags.json only, without images')}">${T('Export tags only')}</button><button class="btn" id="saveMan" title="${T('Save so a copy of this app can restore the image list on its own')}">${T('Save list for copies')}</button><button class="btn" id="tagsEn" title="${T('Turn Korean and other non-English tags into English')}">${T('Tags to English')}</button><button class="btn" id="idTags" title="${T('Pull affiliations such as sects, houses and companies out of set descriptions as identity tags (faction:name). Shows the list before applying')}">${T('Find faction tags')}</button><button class="btn danger" id="wipeAll">${T('Delete all')}</button><span class="muted img-upl-stat" id="uplStat">${esc(statText())}</span></div>`;
}

function setsSectionHtml(sets) {
  return `   <div class="sec"><h4>${T('Character sets ({n})', { n: Object.keys(sets).length })}</h4>
    <div class="row img-search"><input id="setQ" value="${esc(setQuery)}" placeholder="${T('Search sets, names, roles, tags')}" class="search-pill"><button class="btn ghost sort-toggle" id="setSort">${setRecent ? T('Newest first') : T('Upload order')}</button></div><div class="img-gap"></div>
    ${setListHtml(sets)}</div>`;
}

// the character sets matching the search, one page of cards and the pager
function setListHtml(sets) {
  const q = setQuery.trim().toLowerCase();
  let all = Object.entries(sets).filter(([k, imgs]) => {
    if (!q) return true;
    const m = app.setMeta[k] || {};
    return [k, m.charName, m.role, ...(m.aliases || []), ...worldsOf(m), ...imgs.flatMap(x => x.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
  if (setRecent) {
    const newest = imgs => imgs.reduce((m, x) => (String(x.createdAt || '') > m ? String(x.createdAt || '') : m), '');
    all = [...all].sort((a, b) => newest(b[1]).localeCompare(newest(a[1])));
  }
  const pages = Math.max(1, Math.ceil(all.length / SET_PER));
  if (setPage >= pages) setPage = pages - 1;
  const list = all.slice(setPage * SET_PER, (setPage + 1) * SET_PER);
  const pager =
    all.length > SET_PER
      ? `<div class="row pager"><button class="btn ghost" data-spg="-1" ${setPage === 0 ? 'disabled' : ''}>${T('Previous')}</button><span class="muted pager-count">${T('{page} / {pages} ({n})', { page: setPage + 1, pages, n: all.length })}</span><button class="btn ghost" data-spg="1" ${setPage >= pages - 1 ? 'disabled' : ''}>${T('Next')}</button></div>`
      : '';
  return (
    (list.length ? '' : `<p class="muted empty">${T('No results.')}</p>`) +
    list.map(([k, imgs]) => setCardHtml(k, imgs)).join('') +
    pager
  );
}

// one set card: cover, faces, gender, role, standing, fixed name, tags and worlds
function setCardHtml(k, imgs) {
  const m = app.setMeta[k] || {};
  const face = setCover(k, imgs);
  return `<div class="item set-card" data-set="${esc(k)}"><div class="set-head"><div class="who"><img src="${imgUrl(face.id)}" data-big="${face.id}" data-cap="${esc(k + (m.charName ? ' · ' + m.charName : ''))}" loading="lazy" decoding="async" alt=""><div class="names"><b>${esc(k)}</b>${m.charName ? ` <span class="char-name">· ${esc(m.charName)}</span>` : ''}<div class="muted role">${esc(m.role || '')}</div></div></div><div class="muted flags"><span class="count">${T('{n} {n|image|images}', { n: imgs.length })}</span><label title="${T('Use as a faceless shared image. Many extras share it; it never goes to supporting or major characters')}"><input type="checkbox" data-sgen ${isGeneric(k) ? 'checked' : ''} ${(app.setMeta[k] || {}).charName ? `disabled title="${T('A picture with a name on it is never used as a silhouette')}"` : isGeneric(k) && (app.setMeta[k] || {}).tier !== 'generic' ? `disabled title="${T('A silhouette by its file name (shadow_)')}"` : ''}>${T('Silhouette')}</label><label><input type="checkbox" data-soff ${m.off ? 'checked' : ''}>${T('Retired')}</label></div></div>
     ${imgs.length > 1 ? `<div class="row cover-row"><span class="muted cover-label">${T('Cover:')}</span>${imgs.map(x => `<button type="button" data-cover="${x.id}" title="${esc(x.emotion || '')}" class="cover-pick${x.id === face.id ? ' on' : ''}"><img src="${imgUrl(x.id)}" loading="lazy" alt="" class="cover-thumb"></button>`).join('')}</div>` : ''}
     <div class="row set-row"><select data-sf="gender" class="set-select">${[
       ['', T('Gender: auto')],
       [GENDER.FEMALE, T(GENDER_LABEL.female)],
       [GENDER.MALE, T(GENDER_LABEL.male)],
       [GENDER.OTHER, T(GENDER_LABEL.other)],
     ]
       .map(([v, n]) => `<option value="${v}" ${(m.gender || '') === v ? 'selected' : ''}>${n}</option>`)
       .join('')}</select>
     <input data-sf="role" value="${esc(m.role || '')}" placeholder="${T('Role, mood (e.g. knight, cold)')}" class="set-input"></div>
     <div class="row set-row"><select data-sf="tier" class="set-select" title="${T('Casting: sets with many expressions go to major characters, single images to extras')}">${[
       [
         '',
         T('Casting: auto ({tier})', {
           tier: T({ extra: N_('Extra'), minor: N_('Supporting'), major: N_('Major') }[setTier(k)]),
         }),
       ],
       ['major', T('Major character')],
       ['minor', T('Supporting')],
       ['extra', T('Extra')],
       ['generic', T('Silhouette only')],
     ]
       .map(([v, n]) => `<option value="${v}" ${(m.tier || '') === v ? 'selected' : ''}>${n}</option>`)
       .join(
         '',
       )}</select><input data-sf="charName" value="${esc(m.charName || '')}" maxlength="20" placeholder="${T('Fixed name (if the picture has a name on it)')}" class="set-input"><button class="btn ghost" data-srename title="${T("Renaming a set renames every frame and the open save's casting")}">${T('Rename')}</button><input data-sf="aliases" value="${esc((m.aliases || []).join(', '))}" placeholder="${T('Other names (comma separated)')}" class="set-input set-input-narrow"></div><div class="set-row">${worldChips(worldsOf(m), 'data-sw')}</div>
     <div class="seg set-tags">${(() => {
       const all = [...new Set(imgs.flatMap(x => x.tags || []))];
       return [...all.filter(isIdTag), ...all.filter(t => !isIdTag(t))]
         .map(
           t =>
             `<button type="button" data-stag="${esc(t)}" aria-pressed="true" title="${isIdTag(t) ? T('Identity tag: compared as is, never translated') : T('Looks tag: English, compared word by word')}" class="chip-sm set-tag${isIdTag(t) ? ' id' : ''}">${esc(t)} ✕</button>`,
         )
         .join('');
     })()}<input data-stagadd placeholder="${T('Add a tag (an affiliation like faction:Tang Clan)')}" class="set-tag-input"></div></div>`;
}

function allImagesSectionHtml() {
  return `   <div class="sec"><div class="row img-all-head"><h4 class="img-all-title">${T('All images ({n})', { n: app.images.length })}</h4><div class="seg">${[
    ['all', T('All')],
    ['char', T('Characters')],
    ['scene', T('Backgrounds')],
  ]
    .map(([v, n]) => `<button data-flt="${v}" aria-pressed="${imgFilter === v}">${n}</button>`)
    .join('')}</div></div>
    <div class="row img-search img-search-all"><input id="imgQ" value="${esc(imgQuery)}" placeholder="${T('Search names, sets, tags, worlds')}" class="search-pill"><button class="btn ghost sort-toggle" id="imgSort">${imgRecent ? T('Newest first') : T('Upload order')}</button></div><div id="imgGridBox" class="img-grid-box">${imgGrid()}</div></div>`;
}

// the buttons, filters, search boxes and pagers above the sets and the grid
function bindImagesToolbar(box) {
  $('#upl').onchange = e => {
    const files = [...e.target.files];
    e.target.value = ''; // choosing the same files again must fire again
    exclusiveJob(T('Upload'), () => uploadFiles(files));
  };
  $('#tagsIn').onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    exclusiveJob(T('Tag import'), () => importTags(f));
  };
  const at = $('#autoTag');
  if (at) at.onclick = () => exclusiveJob(T('Auto-sort'), autoTagAll);
  $('#dedupe').onclick = () => exclusiveJob(T('Clean up duplicates'), dedupeImages);
  const rc = $('#recover');
  if (rc) rc.onclick = () => exclusiveJob(T('Recover the list'), recoverImages);
  $('#wipeAll').onclick = () => exclusiveJob(T('Delete all'), wipeAllImages);
  $('#expPack').onclick = () => exportPack(true);
  $('#expTags').onclick = () => exportPack(false);
  $('#saveMan').onclick = () => exclusiveJob(T('Save list'), saveManifest);
  $('#tagsEn').onclick = () => exclusiveJob(T('Tags to English'), tagsToEnglish);
  $('#idTags').onclick = () => exclusiveJob(T('Faction tags'), idTagsFromDesc);
  box.querySelectorAll('[data-flt]').forEach(
    b =>
      (b.onclick = () => {
        imgFilter = b.dataset.flt;
        imgPage = 0;
        renderImages();
      }),
  );
  const redraw = () => {
    $('#imgGridBox').innerHTML = imgGrid();
    bindImgGrid();
    bindPager();
  };
  const bindPager = () => {
    box.querySelectorAll('[data-pg]').forEach(
      b =>
        (b.onclick = () => {
          imgPage += +b.dataset.pg;
          redraw();
          $('#imgGridBox').scrollIntoView({ block: 'start' });
        }),
    );
  };
  bindPager();
  box.querySelectorAll('[data-spg]').forEach(
    b =>
      (b.onclick = () => {
        setPage += +b.dataset.spg;
        renderImages();
      }),
  );
  const ss = $('#setSort');
  if (ss)
    ss.onclick = () => {
      setRecent = !setRecent;
      setPage = 0;
      renderImages();
    };
  let sqt = null;
  const sq = $('#setQ');
  if (sq) {
    sq.oninput = e => {
      clearTimeout(sqt);
      sqt = setTimeout(() => {
        setQuery = e.target.value;
        setPage = 0;
        const pos = e.target.selectionStart;
        renderImages().then(() => {
          const n = $('#setQ');
          if (n) {
            n.focus();
            n.setSelectionRange(pos, pos);
          }
        });
      }, 300);
    };
  }
  let qt = null;
  $('#imgQ').oninput = e => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      imgQuery = e.target.value;
      imgPage = 0;
      redraw();
    }, 200);
  };
  $('#imgSort').onclick = () => {
    imgRecent = !imgRecent;
    imgPage = 0;
    renderImages();
  };
}

// what each control on one set card changes; every change is saved to the shared set card
// the set card fields typed in the images tab: how each is stored (undefined removes it)
const SET_FIELDS = {
  aliases: v =>
    v
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .slice(0, 6),
  charName: v => v.slice(0, 20) || undefined,
  tier: v => v || undefined,
};
// changes one set card and saves it; resolves true when saved (a failure is told, and logged)
async function saveSetMeta(k, change) {
  const m = (app.setMeta[k] = app.setMeta[k] || {});
  change(m);
  try {
    await SETDOC(k).set(m);
    return true;
  } catch (err) {
    logErr('set', err);
    if (KEY_RE.test(k)) toast(T('Save failed: {err}', { err: err.code || err.message }));
    else
      toast(
        T(
          'The set name "{set}" has Korean letters or symbols, so it can\'t be saved. Give it an English name with "Rename" on the set card',
          { set: k },
        ),
        6000,
      );
    return false;
  }
}
function bindSetCard(card) {
  const k = card.dataset.set;
  card.querySelectorAll('[data-sf]').forEach(
    el =>
      (el.onchange = () =>
        saveSetMeta(k, m => {
          const f = el.dataset.sf;
          const v = SET_FIELDS[f] ? SET_FIELDS[f](el.value.trim()) : el.value.trim();
          if (v === undefined) delete m[f];
          else m[f] = v;
        })),
  );
  card.querySelectorAll('[data-cover]').forEach(
    b =>
      (b.onclick = async () => {
        await saveSetMeta(k, m => (m.cover = b.dataset.cover));
        renderImages();
      }),
  );
  const rn = card.querySelector('[data-srename]');
  if (rn) rn.onclick = () => renameSet(k);
  const gen = card.querySelector('[data-sgen]');
  if (gen)
    gen.onchange = async () => {
      const saved = await saveSetMeta(k, m => {
        if (gen.checked) m.tier = 'generic';
        else if (m.tier === 'generic') delete m.tier;
      });
      if (saved)
        toast(
          gen.checked
            ? T('{set}: silhouette only (never used as a real face)', { set: k })
            : T('{set}: back to a regular set', { set: k }),
        );
      renderImages();
    };
  const off = card.querySelector('[data-soff]');
  if (off)
    off.onchange = async () => {
      const saved = await saveSetMeta(k, m => {
        if (off.checked) m.off = true;
        else delete m.off;
      });
      if (saved)
        toast(
          off.checked
            ? T('{set}: will not be assigned from now on', { set: k })
            : T('{set}: assigned again', { set: k }),
        );
    };
  card.querySelectorAll('[data-stag]').forEach(
    b =>
      (b.onclick = async () => {
        const t = b.dataset.stag;
        let fail = null;
        for (const x of app.images.filter(i => i.kind === 'char' && (i.set || i.name) === k)) {
          if ((x.tags || []).includes(t)) {
            x.tags = x.tags.filter(v => v !== t);
            try {
              await IMGDOC(x.id).set(x);
            } catch (err) {
              fail = err;
            }
          }
        }
        if (fail) {
          toast(T('Save failed: {err}', { err: fail.code || fail.message }));
          logErr('tag', fail);
        }
        renderImages();
      }),
  );
  const add = card.querySelector('[data-stagadd]');
  if (add)
    add.onkeydown = async e => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      let t = add.value.trim();
      if (!t) return;
      add.disabled = true;
      t = (await toEnglishTags([t]))[0];
      let fail = null;
      for (const x of app.images.filter(i => i.kind === 'char' && (i.set || i.name) === k)) {
        x.tags = capTags([...(x.tags || []), t]);
        try {
          await IMGDOC(x.id).set(x);
        } catch (err) {
          fail = err;
        }
      }
      if (fail) {
        toast(T('Save failed: {err}', { err: fail.code || fail.message }));
        logErr('tag', fail);
      }
      renderImages();
    };
  card.querySelectorAll('[data-sw]').forEach(
    b =>
      (b.onclick = e => {
        e.preventDefault();
        saveSetMeta(k, m => {
          const ws = new Set(worldsOf(m));
          const id2 = b.dataset.sw;
          if (ws.has(id2)) ws.delete(id2);
          else ws.add(id2);
          setWorlds(m, [...ws]);
          card.querySelectorAll('[data-sw]').forEach(x => x.setAttribute('aria-pressed', String(ws.has(x.dataset.sw))));
        });
      }),
  );
}
let imgQuery = '',
  imgPage = 0,
  imgRecent = true;
const IMG_PER = 60;
let setQuery = '',
  setPage = 0,
  setRecent = false;
const SET_PER = 10;
function showBigImage(id, caption) {
  openSheet(
    `<div class="big-image"><img src="${imgUrl(id)}" alt="" class="big-image-pic">${caption ? `<p class="muted big-image-cap">${esc(caption)}</p>` : ''}<div class="row actions centered"><button class="btn" data-close>${T('Close')}</button></div></div>`,
    { center: true },
  );
}
function imgGrid() {
  const q = imgQuery.trim().toLowerCase();
  let all = app.images
    .filter(x => imgFilter === 'all' || x.kind === imgFilter)
    .filter(
      x =>
        !q ||
        [x.name, x.file, x.set, x.emotion, ...(x.tags || []), ...worldsOf(x)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
    );
  if (imgRecent) all = [...all].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))); // what you just uploaded is at the top
  const pages = Math.max(1, Math.ceil(all.length / IMG_PER));
  if (imgPage >= pages) imgPage = pages - 1;
  const list = all.slice(imgPage * IMG_PER, (imgPage + 1) * IMG_PER);
  const pager =
    all.length > IMG_PER
      ? `<div class="row pager pager-below"><button class="btn ghost" data-pg="-1" ${imgPage === 0 ? 'disabled' : ''}>${T('Previous')}</button><span class="muted pager-count">${T('{page} / {pages} ({n} {n|image|images})', { page: imgPage + 1, pages, n: all.length })}</span><button class="btn ghost" data-pg="1" ${imgPage >= pages - 1 ? 'disabled' : ''}>${T('Next')}</button></div>`
      : '';
  if (!list.length) return '<p class="muted">' + (q ? T('No results.') : T('No images yet.')) + '</p>';
  const sel = 'class="img-field-select"';
  return `<div class="imggrid">${list
    .map(
      x => `<div class="img" data-id="${x.id}"><img class="th th-img" data-big="${x.id}" data-cap="${esc(x.file || x.name || '')}" src="${imgUrl(x.id)}" loading="lazy" decoding="async" alt=""><div class="f">
    <select data-f="kind" ${sel}><option value="char" ${x.kind === 'char' ? 'selected' : ''}>${T('Character')}</option><option value="scene" ${x.kind === 'scene' ? 'selected' : ''}>${T('Background')}</option><option value="fx" ${x.kind === 'fx' ? 'selected' : ''}>${T('Effect (dice)')}</option></select>
    ${
      x.kind === 'char'
        ? `<input data-f="set" value="${esc(x.set || x.name || '')}" placeholder="${T('Set (female1)')}"><select data-f="emotion" ${sel}>${EMOS.map(e => `<option ${(x.emotion || 'neutral') === e ? 'selected' : ''}>${e}</option>`).join('')}</select>`
        : x.kind === 'fx'
          ? `<input data-f="name" value="${esc(x.name || '')}" placeholder="dice, dice_success, dice_fail">`
          : `<input data-f="name" value="${esc(x.name || '')}" placeholder="${T('Background name (tavern_night)')}">${worldChips(worldsOf(x), 'data-w')}`
    }
    <input data-f="tags" value="${esc((x.tags || []).join(', '))}" placeholder="${x.kind === 'char' ? T('Tags: armor, wounded, night') : T('Tags: inn, night, rain, crowded')}">
    <button class="btn danger img-del" data-delimg>${T('Delete')}</button></div></div>`,
    )
    .join('')}</div>${pager}`;
}
function bindImgGrid() {
  document.querySelectorAll('.img[data-id]').forEach(card => {
    const id = card.dataset.id;
    const x = app.images.find(i => i.id === id);
    card.querySelectorAll('[data-w]').forEach(
      b =>
        (b.onclick = async e => {
          e.preventDefault();
          const ws = new Set(worldsOf(x));
          const id2 = b.dataset.w;
          if (ws.has(id2)) ws.delete(id2);
          else ws.add(id2);
          setWorlds(x, [...ws]);
          card.querySelectorAll('[data-w]').forEach(y => y.setAttribute('aria-pressed', String(ws.has(y.dataset.w))));
          try {
            await IMGDOC(id).set(x);
          } catch (err) {
            toast(T('Save failed: {err}', { err: err.code || err.message }));
            logErr('img', err);
          }
        }),
    );
    card.querySelectorAll('[data-f]').forEach(
      el =>
        (el.onchange = async () => {
          const f = el.dataset.f;
          x[f] =
            f === 'tags'
              ? capTags(
                  await toEnglishTags(
                    el.value
                      .split(',')
                      .map(t => t.trim())
                      .filter(Boolean),
                  ),
                )
              : el.value.trim();
          if (f === 'tags') el.value = x.tags.join(', ');
          if (f === 'set' && x.set && !KEY_RE.test(x.set)) {
            toast(T('Set names may only use English letters, digits, _ and -'), 4000);
            el.value = x.set = el.dataset.prev || '';
            return;
          }
          if (f === 'set') el.dataset.prev = x.set;
          if (x.kind === 'char' && (f === 'set' || f === 'emotion') && x.set)
            x.name = `${x.set}_${x.emotion || 'neutral'}${x.variant ? '_' + x.variant : ''}`;
          try {
            await IMGDOC(id).set(x);
          } catch (err) {
            toast(T('Save failed: {err}', { err: err.code || err.message }));
            logErr('img', err);
          }
          if (f === 'kind' || f === 'set') renderImages();
        }),
    );
    const del = card.querySelector('[data-delimg]');
    if (del)
      del.onclick = async () => {
        if (!(await askConfirm(T('Delete this image? This cannot be undone.')))) return;
        try {
          await platform.assets.delete(id);
        } catch (e) {
          noteIgnored('delete image: asset', e);
        }
        await IMGDOC(id)
          .delete()
          .catch(e => noteIgnored('images-view: IMGDOC.delete', e));
        app.images = app.images.filter(i => i.id !== id);
        renderImages();
      };
  });
}
async function compress(file) {
  try {
    const bmp = await createImageBitmap(file);
    const portrait = bmp.height > bmp.width * 1.1;
    const max = portrait ? 1100 : 1400;
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.type === 'image/webp') return { blob: file, portrait }; // already stored size: keep the bytes (no second compression)
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k);
    cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/webp', 0.84));
    return { blob: blob || file, portrait };
  } catch (e) {
    return { blob: file, portrait: false };
  }
}
// "smile" or "smile2" (a number glued to the emotion): the emotion plus the number, else null
function splitEmoNum(tok) {
  const m = /^([a-z]+?)(\d*)$/.exec(tok || '');
  return m && EMOS.includes(m[1]) ? { emo: m[1], num: m[2] } : null;
}
function parseName(fname, portrait) {
  const base = fname.replace(/\.[^.]+$/, '');
  const parts = base
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(s => s.toLowerCase());
  if (parts[0] === 'bg' || parts[0] === 'background')
    return { kind: 'scene', name: parts.slice(1).join('_') || base, tags: parts.slice(1) };
  if (/^(dice|fx)/.test(parts[0] || '')) return { kind: 'fx', name: base.toLowerCase(), tags: parts };
  if (/^(shadow|generic|silhouette)$/.test(parts[0] || '')) {
    const gender = w =>
      /^(female|woman|women|girl)/.test(w) ? 'female' : /^(male|man|men|boy)/.test(w) ? 'male' : null;
    // shadow_{male|female}_..., or with a style word first: shadow_cyber_male_... (its own set shadow_cyber_male)
    let g = gender(parts[1] || ''),
      at = 1,
      style = '';
    if (
      !g &&
      /^[a-z0-9-]+$/.test(parts[1] || '') &&
      /^(female|woman|women|girl|male|man|men|boy)$/.test(parts[2] || '')
    ) {
      style = parts[1];
      g = gender(parts[2]);
      at = 2;
    }
    const rest = g ? parts.slice(at + 1) : parts.slice(2);
    if (!g) g = 'other';
    const e0 = splitEmoNum(rest[0]);
    if (e0) rest.splice(0, 1, ...(e0.num ? [e0.num] : []));
    const emo = e0 ? e0.emo : 'neutral';
    return {
      kind: 'char',
      set: 'shadow_' + (style ? style + '_' : '') + g,
      emotion: emo,
      variant: rest.join('_'),
      name: base.toLowerCase(),
      tags: ['shadow', 'silhouette', ...(style ? [style] : [])],
      shadowGender: g,
    };
  }
  const e1 = parts.length >= 2 ? splitEmoNum(parts[1]) : null;
  if (e1)
    return {
      kind: 'char',
      set: parts[0],
      emotion: e1.emo,
      variant: [...(e1.num ? [e1.num] : []), ...parts.slice(2)].join('_'),
      name: base,
      tags: parts,
    };
  if (portrait) {
    const k0 = parts[0] || base;
    return KEY_RE.test(k0)
      ? { kind: 'char', set: k0, emotion: 'neutral', name: base, tags: parts, guessed: true }
      : { kind: 'char', set: null, emotion: 'neutral', name: base, tags: [], guessed: true };
  }
  return { kind: 'scene', name: base.toLowerCase(), tags: parts, guessed: true };
}
const KEY_RE = /^[A-Za-z0-9_\-.~:@+]+$/; // a set key is a db document id
// the next free number, so nobody has to count
function nextSetKey(g) {
  const pre = g === 'female' ? 'female' : g === 'male' ? 'male' : 'other';
  let mx = 0;
  for (const k of Object.keys(charSetsAll())) {
    const m = new RegExp('^' + pre + '(\\d+)$').exec(k);
    if (m) mx = Math.max(mx, +m[1]);
  }
  return pre + (mx + 1);
}
function askUploadPlan(n) {
  // files whose names say nothing: ask once for the batch, or keep the shape-based guess
  const answer =
    openDialog(`<h3 class="upl-title">${T('{n} {n|file|files} not recognized by name', { n })}</h3><p class="muted sheet-lead">${T("The file names aren't like <code>female3_smile.png</code>. How should they go in? Set numbers are added automatically.")}</p>
    <div class="seg upl-seg"><button type="button" data-k="char" aria-pressed="true">${T('Character')}</button><button type="button" data-k="scene">${T('Background')}</button><button type="button" data-k="fx">${T('Effect')}</button></div>
    <div id="upFx" class="hidden"><div class="seg upl-seg"><button type="button" data-fx="dice success" aria-pressed="true">${T('Dice: critical success')}</button><button type="button" data-fx="dice fail">${T('Dice: critical failure')}</button><button type="button" data-fx="dice">${T('Dice: default')}</button></div></div>
    <div id="upChar"><div class="seg upl-seg"><button type="button" data-g="female" aria-pressed="true">${T(GENDER_LABEL.female)}</button><button type="button" data-g="male">${T(GENDER_LABEL.male)}</button><button type="button" data-g="other">${T(GENDER_LABEL.other)}</button></div>
    <div class="seg upl-seg"><button type="button" data-grp="each" aria-pressed="true">${T('Each a different person')}</button><button type="button" data-grp="one">${T("One person's expression frames")}</button></div><p class="muted upl-note">${T('Expressions start as neutral. After uploading, "Auto-sort" sets them.')}</p></div>
    <div class="row"><button class="btn primary" id="upOk">${T('Upload like this')}</button><button class="btn ghost" id="upGuess">${T('Guess from the shape')}</button></div>`);
  const box = $('#sheetInner');
  const pick = (sel, attr) => {
    box.querySelectorAll(sel).forEach(
      b =>
        (b.onclick = () => {
          box.querySelectorAll(sel).forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          if (attr === 'k') {
            $('#upChar').classList.toggle('hidden', b.dataset.k !== 'char');
            $('#upFx').classList.toggle('hidden', b.dataset.k !== 'fx');
          }
        }),
    );
  };
  pick('[data-k]', 'k');
  pick('[data-g]');
  pick('[data-grp]');
  pick('[data-fx]');
  const get = sel => box.querySelector(sel + '[aria-pressed="true"]');
  $('#upOk').onclick = () =>
    answerDialog({
      kind: get('[data-k]').dataset.k,
      gender: get('[data-g]').dataset.g,
      group: get('[data-grp]').dataset.grp,
      fx: get('[data-fx]').dataset.fx.split(' '),
    });
  $('#upGuess').onclick = () => answerDialog(null);
  return answer;
}
// One long job at a time: a second upload (or a second tab) would send the same pictures twice.
let busy = '';
async function exclusiveJob(name, job) {
  if (busy) {
    toast(T('{job} is running. Try again when it is done', { job: busy }), 4000);
    return;
  }
  busy = name;
  try {
    if (!navigator.locks) return await job();
    let started = false;
    try {
      return await navigator.locks.request('dr-image-job', { ifAvailable: true }, async lock => {
        if (!lock) {
          toast(T('An image job is running in another window. Try again when it is done'), 4500);
          return;
        }
        started = true;
        return await job();
      });
    } catch (e) {
      if (started) throw e;
      return await job(); // locks are not available in this page: go on without them
    }
  } finally {
    busy = '';
  }
}
const UPLOAD_PAR = 3; // pictures sent at the same time (it drops to 1 when uploads start failing, and climbs back)
const UPLOAD_RETRIES = 2;
const MAX_UNSAVED = 9; // pictures sent but not yet in the saved list: the most a closed window could lose
const NO_RETRY = new Set(['quota_or_state', 'quota_exceeded', 'too_large']);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function uploadFiles(files) {
  let done = 0,
    skipped = 0,
    stop = false;
  const failed = [],
    landed = [];
  await fillHashes(t => setStat(t), T('Checking existing images'));
  const t0 = Date.now();
  const unnamed = files.filter(f => parseName(f.name, true).guessed);
  const plan = unnamed.length ? await askUploadPlan(unnamed.length) : null;
  let sharedKey = null;
  const newSets = new Set();
  const inflight = new Set(); // names and hashes being sent right now: the same file twice in one batch
  const time = { n: 0, compress: 0, upload: 0, save: 0 }; // milliseconds, to see where the time goes
  let par = UPLOAD_PAR,
    okRun = 0,
    running = 0,
    unsaved = 0;
  const saves = [];
  const fail = (f, e) => {
    failed.push([
      f.name,
      e.code === 'quota_or_state'
        ? T('Storage full')
        : e.code === 'too_large'
          ? T('File too large')
          : e.code || e.message || T('Failed'),
    ]);
    if (e.code === 'quota_or_state' || e.code === 'quota_exceeded') stop = true;
  };
  const say = () => {
    const el = done ? Math.round((((Date.now() - t0) / done) * (files.length - done)) / 1000) : 0;
    setStat(
      T('Uploading {done}/{total}', { done, total: files.length }) +
        (skipped ? T(', skipped {n}', { n: skipped }) : '') +
        (failed.length ? T(', failed {n}', { n: failed.length }) : '') +
        (el > 5
          ? T(', about {time} left', {
              time: el >= 60 ? T('{n} min', { n: Math.round(el / 60) }) : T('{n} s', { n: el }),
            })
          : ''),
    );
  };
  const sendWithRetry = async (blob, f) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await platform.assets.upload(blob, { type: blob.type || f.type });
      } catch (e) {
        if (NO_RETRY.has(e.code) || attempt >= UPLOAD_RETRIES) throw e;
        par = Math.max(1, par - 1); // maybe too many at once: slow down, then try the same picture again
        okRun = 0;
        await wait(1000 * 2 ** attempt);
      }
    }
  };
  const one = async (f, lane) => {
    const hash = await sha256Hex(f).catch(() => null);
    // an exported pack holds the stored (already compressed) files under new names: they match by the stored file hash
    if (
      app.images.some(x => (hash && (x.hash === hash || x.shash === hash)) || x.file === f.name) ||
      inflight.has(f.name) ||
      (hash && inflight.has(hash))
    ) {
      skipped++;
      return;
    }
    inflight.add(f.name);
    if (hash) inflight.add(hash);
    let row = null;
    try {
      let t = performance.now();
      const { blob, portrait } = await compress(f);
      time.compress += performance.now() - t;
      t = performance.now();
      const r = await sendWithRetry(blob, f);
      time.upload += performance.now() - t;
      if (++okRun >= 20 && par < UPLOAD_PAR) {
        par++;
        okRun = 0;
      }
      const shash = await sha256Hex(blob).catch(() => null); // no hash: this upload just skips the duplicate check
      // From here to the push there is no await: set names are picked from what the list holds right now, so two
      // pictures sent at the same time never get the same new set.
      let parsed = parseName(f.name, portrait);
      let guessed = !!parsed.guessed;
      delete parsed.guessed;
      if (parsed.kind === 'char' && !parsed.set) {
        const key = nextSetKey('other');
        parsed.set = key;
        parsed.name = key + '_neutral';
        newSets.add(key);
      } // a Korean file name cannot be a set key
      let shadow = null;
      if (parsed.shadowGender) {
        shadow = parsed.shadowGender;
        delete parsed.shadowGender;
        app.setMeta[parsed.set] = Object.assign(app.setMeta[parsed.set] || {}, { gender: shadow, tier: 'generic' });
      }
      if (guessed && plan) {
        const base = f.name.replace(/\.[^.]+$/, '');
        guessed = false;
        if (plan.kind === 'char') {
          const key =
            plan.group === 'one' ? (sharedKey = sharedKey || nextSetKey(plan.gender)) : nextSetKey(plan.gender);
          parsed = { kind: 'char', set: key, emotion: 'neutral', name: key + '_neutral', tags: [] };
          newSets.add(key);
        } else if (plan.kind === 'scene') parsed = { kind: 'scene', name: base.toLowerCase(), tags: [] };
        else parsed = { kind: 'fx', name: base.toLowerCase(), tags: plan.fx || ['dice'] };
      }
      row = Object.assign({ id: r.id, world: 'any', file: f.name, hash, shash, createdAt: nowIso() }, parsed);
      const page = IMGX.laneAssign(row.id, lane);
      app.images.push(row);
      const mine = row,
        setKey = parsed.set;
      row = null; // from here the save below owns the picture (and its rollback)
      unsaved++;
      const t1 = performance.now();
      // the list is written right away; pictures that land while it runs ride in the next write. The next upload does not wait.
      saves.push(
        IMGX.save(page)
          .then(
            async () => {
              time.save += performance.now() - t1;
              time.n++;
              landed.push({ file: f.name, row: mine, guessed });
              if (shadow)
                await SETDOC(setKey)
                  .set(app.setMeta[setKey])
                  .catch(e => logErr('upload', e));
            },
            e => {
              app.images = app.images.filter(x => x !== mine); // the list write failed: the picture is not in the library
              IMGX.map.delete(mine.id);
              fail(f, e);
            },
          )
          .finally(() => unsaved--),
      );
    } catch (e) {
      if (row) {
        app.images = app.images.filter(x => x !== row); // the list write failed: the picture is not in the library
        IMGX.map.delete(row.id);
      }
      throw e;
    } finally {
      inflight.delete(f.name);
      if (hash) inflight.delete(hash);
    }
  };
  IMGX.lanes = [];
  const queue = files.map((f, i) => [f, i % UPLOAD_PAR]); // each picture is tied to a lane (its own list page)
  const worker = async () => {
    while (queue.length && !stop) {
      if (running >= par) {
        await wait(50);
        continue;
      }
      if (unsaved >= MAX_UNSAVED) {
        await wait(20);
        continue;
      }
      const [f, lane] = queue.shift();
      running++;
      try {
        await one(f, lane);
      } catch (e) {
        fail(f, e);
      } finally {
        running--;
        done++;
        say();
      }
    }
  };
  const guard = e => {
    e.preventDefault();
    e.returnValue = ''; // leaving now would lose the pictures still being sent
  };
  window.addEventListener('beforeunload', guard);
  say();
  try {
    await Promise.all(Array.from({ length: UPLOAD_PAR }, worker));
    await Promise.all(saves);
  } finally {
    window.removeEventListener('beforeunload', guard);
  }
  for (const key of newSets) {
    const m = (app.setMeta[key] = Object.assign(
      app.setMeta[key] || {},
      plan && plan.kind === 'char' ? { gender: plan.gender } : {},
    ));
    try {
      await SETDOC(key).set(m);
    } catch (e) {
      logErr('upload', e);
    }
  }
  setStat('');
  if (time.n >= 5) {
    const avg = ms => Math.round(ms / time.n);
    const msg = T('Average per image: compress {c}ms, upload {u}ms, list save {s}ms ({par} at once)', {
      c: avg(time.compress),
      u: avg(time.upload),
      s: avg(time.save),
      par: UPLOAD_PAR,
    });
    console.info('[upload]', msg);
    toast(msg, 6000);
  }
  if (skipped) toast(T('Skipped {n} {n|image|images} already in the library', { n: skipped }));
  if (newSets.size) toast(T('Added as new sets: {sets}', { sets: [...newSets].join(', ') }), 4000);
  if (landed.length) {
    imgRecent = true;
    imgPage = 0;
    imgQuery = '';
    imgFilter = 'all';
  }
  renderImages();
  const guessed = landed.filter(x => x.guessed);
  if (guessed.length && !failed.length)
    openSheet(
      `<h3>${T('{n} {n|file|files} not recognized by name', { n: guessed.length })}</h3><p class="muted upl-lead">${T("The file names aren't like <code>female3_smile.png</code> (set_expression), so they were guessed from their shape. They are at the top of the image list, where you can fix the kind, set and expression.")}</p><div class="upl-list">${guessed.map(x => `<div class="upl-item">${esc(x.file)} → ${x.row.kind === 'char' ? T('character set <b>{set}</b> (expression neutral)', { set: esc(x.row.set) }) : T('background <b>{name}</b>', { name: esc(x.row.name) })}</div>`).join('')}</div><div class="row actions"><button class="btn primary" data-close>${T('OK')}</button></div>`,
    );
  if (failed.length)
    openSheet(
      `<h3>${T("{n} {n|file|files} couldn't be uploaded", { n: failed.length })}</h3><p class="muted upl-lead">${T('Select the same files again: the ones already uploaded are skipped and only these are retried.')}</p><div class="upl-failed">${failed.map(([f, r]) => esc(f) + '  -  ' + esc(r)).join('\n')}</div><div class="row actions"><button class="btn" data-close>${T('Close')}</button></div>`,
    );
}
function askText(title, value = '') {
  const answer = openDialog(
    `<p class="dlg-msg">${esc(title)}</p><input id="dlgTx" value="${esc(value)}" maxlength="30" class="dlg-input"><div class="row actions"><button class="btn primary" id="dlgOk">${T('OK')}</button><button class="btn ghost" id="dlgNo">${T('Cancel')}</button></div>`,
  );
  const tx = $('#dlgTx');
  tx.focus();
  tx.onkeydown = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#dlgOk').click();
    }
  };
  $('#dlgOk').onclick = () => answerDialog(tx.value.trim() || null);
  $('#dlgNo').onclick = () => answerDialog(null);
  return answer;
}
async function renameSet(oldK) {
  // a set key is what saves point at, so the current save follows; other saves keep the old key and lose that face
  const nk = await askText(
    T('New name for set "{set}" (English letters, digits, _ -)', { set: oldK }),
    KEY_RE.test(oldK) ? oldK : nextSetKey((app.setMeta[oldK] || {}).gender || genderOf(oldK) || 'other'),
  );
  if (!nk || nk === oldK) return;
  const key = nk.replace(/\s+/g, '_');
  if (!KEY_RE.test(key)) {
    toast(
      T(
        'Set names may only use English letters, digits, _ and -. Put a Korean name in the fixed name field on the set card',
      ),
      5000,
    );
    return;
  }
  if (charSetsAll()[key]) {
    toast(T('That set name is taken'));
    return;
  }
  const imgs = charSetsAll()[oldK] || [];
  for (const x of imgs) {
    x.set = key;
    x.name = `${key}_${x.emotion || 'neutral'}${x.variant ? '_' + x.variant : ''}`;
  }
  const m = app.setMeta[oldK];
  if (m) {
    app.setMeta[key] = m;
    delete app.setMeta[oldK];
  }
  try {
    await IMGX.flush(imgs.map(x => x.id));
    if (m) {
      await SETDOC(key).set(m);
      await SETDOC(oldK)
        .delete()
        .catch(e => noteIgnored('images-view: SETDOC.delete', e));
    }
  } catch (e) {
    toast(T('Save failed: {err}', { err: e.code || e.message }));
    return;
  }
  if (app.state) {
    let ch = false;
    for (const [n, k] of Object.entries(app.state.cast || {}))
      if (k === oldK) {
        app.state.cast[n] = key;
        ch = true;
      }
    for (const d of Object.values(app.state.deadNpc || {}))
      if (d.set === oldK) {
        d.set = key;
        ch = true;
      }
    if (ch) await persist();
  }
  toast(T('{from} → {to}: renamed {n} {n|frame|frames}', { from: oldK, to: key, n: imgs.length }), 4000);
  renderImages();
}
async function idTagsFromDesc() {
  // the descriptions already say "사천당가 소저": lift what each set belongs to into identity tags, reviewed before it lands
  const ks = Object.keys(charSetsAll()).filter(k => {
    const m = app.setMeta[k] || {};
    return m.role && !setIds(k).length;
  });
  if (!ks.length) {
    toast(T('No descriptions to find affiliations in (sets with a description and no identity tag)'));
    return;
  }
  if (!platform.sample) {
    toast(T("Can't call Claude"));
    return;
  }
  if (
    !(await askConfirm(
      T(
        'Find affiliations (sect, house, nation, company...) in {n} {n|set|sets} with a description and no identity tag? This calls a light model {calls} {calls|time|times} and shows the list before applying.',
        { n: ks.length, calls: Math.ceil(ks.length / 25) },
      ),
    ))
  )
    return;
  const found = [];
  for (let i = 0; i < ks.length; i += 25) {
    setStat(T('Finding affiliations {i}/{n}', { i: Math.min(i + 25, ks.length), n: ks.length }));
    const part = ks.slice(i, i + 25);
    try {
      const r = await platform.sample.json(
        // i18n-ignore: Korean examples for the model
        `For each character description, list what the character belongs to (a sect, clan, house, nation, company, school, guild or unit) as "kind:name". kind is one short lowercase English word such as faction, house, nation, company, school, guild, unit; name is copied exactly as written in the description, in its own language, without any gloss in parentheses (e.g. "사천당가 소저, 암기를 다루는 여인" -> ["faction:사천당가"]). Give an empty array when the description names nothing they belong to. Reply with only a JSON array of arrays, same order.\n${JSON.stringify(part.map(k => app.setMeta[k].role))}`,
        { modelTier: 'quick' },
      );
      if (Array.isArray(r))
        part.forEach((k, j) => {
          const tags = (Array.isArray(r[j]) ? r[j] : [])
            .map(x => String(x).trim())
            .filter(isIdTag)
            .slice(0, 3);
          if (tags.length)
            found.push([k + (app.setMeta[k].charName ? ' (' + app.setMeta[k].charName + ')' : ''), tags.join(', '), k]);
        });
    } catch (e) {
      logErr('idtags', e);
    }
  }
  setStat('');
  if (!found.length) {
    toast(T('No affiliations found in the descriptions'));
    return;
  }
  const sel = await askReview(
    T('Affiliation tags by set. Uncheck any that are wrong.'),
    found.map(([a, b]) => [a, b]),
  );
  if (!sel) return;
  const byLabel = new Map(found.map(([a, b, k]) => [a, k]));
  const touched = [];
  for (const [a, b] of sel) {
    const k = byLabel.get(a);
    const st2 = b
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
    for (const x of charSetsAll()[k] || []) {
      x.tags = capTags([...st2, ...(x.tags || [])]);
      touched.push(x.id);
    }
  }
  try {
    await IMGX.flush(touched, (n, t) => {
      setStat(T('Saving {i}/{n}', { i: n, n: t }));
    });
  } catch (e) {
    toast(T('Save failed: {err}', { err: e.code || e.message }));
  }
  setStat('');
  toast(T('Applied affiliation tags to {n} {n|set|sets}', { n: sel.length }), 4000);
  renderImages();
}
async function tagsToEnglish() {
  // one pass over the whole library: every non-English tag becomes its English matching key
  const uniq = [
    ...new Set(
      app.images
        .flatMap(x => x.tags || [])
        .map(t => String(t).trim())
        .filter(t => /[^\x00-\x7F]/.test(t) && !isIdTag(t)),
    ),
  ];
  const descSets = Object.keys(charSetsAll()).filter(k => {
    const m = app.setMeta[k] || {};
    return m.role && /[^\x00-\x7F]/.test(m.role) && !(m.kw && m.kw.length);
  });
  if (!uniq.length && !descSets.length) {
    toast(T('No tags or descriptions to turn into English'));
    return;
  }
  if (!platform.sample) {
    toast(T("Can't call Claude"));
    return;
  }
  if (
    !(await askConfirm(
      T(
        'Turn {tags} {tags|tag|tags} into English and pull English keywords from {sets} {sets|set|sets} with Korean descriptions? This calls a light model {calls} {calls|time|times}.',
        {
          tags: uniq.length,
          sets: descSets.length,
          calls: Math.ceil(uniq.length / 60) + Math.ceil(descSets.length / 25),
        },
      ),
    ))
  )
    return;
  const map = new Map();
  for (let i = 0; i < descSets.length; i += 25) {
    setStat(T('Reading descriptions {i}/{n}', { i: Math.min(i + 25, descSets.length), n: descSets.length }));
    const part = descSets.slice(i, i + 25);
    try {
      const r = await platform.sample.json(
        // i18n-ignore: Korean example for the model
        `For each character description, give 3-6 short lowercase English keywords covering race, role, clothing or look, and vibe (e.g. "어둠의 마법을 다루는 엘프 귀족, 우아하고 도도한 분위기" -> ["elf","noble","dark mage","elegant","haughty"]). Reply with only a JSON array of arrays, same order.\n${JSON.stringify(part.map(k => app.setMeta[k].role))}`,
        { modelTier: 'quick' },
      );
      if (Array.isArray(r))
        await Promise.all(
          part.map(async (k, j) => {
            const kw = (Array.isArray(r[j]) ? r[j] : [])
              .map(x => String(x).toLowerCase().trim())
              .filter(x => x && !/[^\x00-\x7F]/.test(x))
              .slice(0, 6);
            if (!kw.length) return;
            app.setMeta[k].kw = kw;
            try {
              await SETDOC(k).set(app.setMeta[k]);
            } catch (e) {
              noteIgnored('set keywords: save the set card', e);
            }
          }),
        );
    } catch (e) {
      logErr('kw', e);
    }
  }
  for (let i = 0; i < uniq.length; i += 60) {
    setStat(T('Translating {i}/{n}', { i: Math.min(i + 60, uniq.length), n: uniq.length }));
    const part = uniq.slice(i, i + 60);
    const out = await toEnglishTags(part);
    part.forEach((t, j) => {
      const e = String(out[j] || '').trim();
      if (e && e !== t && !/[^\x00-\x7F]/.test(e)) map.set(t, e.toLowerCase());
    });
  }
  setStat('');
  if (map.size) {
    const sel = await askReview(
      T('The translations. Uncheck any proper noun that changed (unchecked tags stay as they are).'),
      [...map.entries()],
    );
    if (!sel) return;
    map.clear();
    for (const [a, b] of sel) map.set(a, b);
  }
  const touched = [];
  for (const x of app.images) {
    if (!x.tags || !x.tags.some(t => map.has(String(t).trim()))) continue;
    x.tags = capTags(x.tags.map(t => map.get(String(t).trim()) || t));
    touched.push(x.id);
  }
  try {
    await IMGX.flush(touched, (n, t) => {
      setStat(T('Saving {i}/{n}', { i: n, n: t }));
    });
  } catch (e) {
    toast(T('Save failed: {err}', { err: e.code || e.message }));
  }
  setStat('');
  toast(
    T('Translated {n} {n|tag|tags}, updated {imgs} {imgs|image|images}', { n: map.size, imgs: touched.length }) +
      (uniq.length - map.size
        ? T(', kept {n} as they were (proper nouns and such)', { n: uniq.length - map.size })
        : ''),
    5000,
  );
  renderImages();
}
export async function importTags(file) {
  if (!file) return;
  let j;
  try {
    j = JSON.parse(await file.text());
  } catch (e) {
    toast(T("Can't read the JSON"));
    return;
  }
  const say = t => {
    setStat(t);
  };
  let ns = 0,
    nb = 0,
    ni = 0;
  const wl = m => {
    const a = Array.isArray(m.worlds) ? m.worlds : m.world && m.world !== 'any' ? [m.world] : [];
    return a.filter(x => WORLDS.some(w => w.id === x));
  };
  const byKey = new Map();
  for (const i of app.images) {
    for (const k of [i.file, i.name, 'bg_' + i.name, (i.file || '').replace(/\.[^.]+$/, '')])
      if (k && !byKey.has(k)) byKey.set(k, i);
  }
  const findImg = fn => byKey.get(fn) || byKey.get(fn.replace(/\.[^.]+$/, ''));
  const toTags = v =>
    Array.isArray(v)
      ? v.map(t => String(t).trim()).filter(Boolean)
      : String(v || '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
  // only sets that have pictures here are used; a set in the file with no pictures uploaded is ignored (it would only
  // leave an empty set card behind and use up a database document)
  const allSets = Object.entries(j.sets || {}),
    setEntries = allSets.filter(([k]) => charSetsAll()[k]),
    setTagsIn = {};
  const replaceTags = j.merge_tags !== true; // the file's tags win; "merge_tags": true keeps the old ones too
  const imgHit = Object.keys(j.images || {}).filter(fn => findImg(fn)).length,
    bgHit = Object.keys(j.backgrounds || {}).filter(fn => findImg(fn)).length,
    setHit = setEntries.length;
  if (!imgHit && !bgHit && !setHit) {
    toast(T('No file or set names match the list'));
    return;
  }
  if (
    !(await askConfirm(
      T('Applies to {sets}/{setsAll} sets, {imgs}/{imgsAll} images and {bgs}/{bgsAll} backgrounds.', {
        sets: setHit,
        setsAll: allSets.length,
        imgs: imgHit,
        imgsAll: Object.keys(j.images || {}).length,
        bgs: bgHit,
        bgsAll: Object.keys(j.backgrounds || {}).length,
      }) +
        '\n' +
        (replaceTags
          ? T("Image tags are replaced by the file's tags (old tags are removed). Go ahead?")
          : T('Image tags are merged with the old ones (merge_tags). Go ahead?')),
    ))
  )
    return;
  for (let i = 0; i < setEntries.length; i += 8) {
    say(T('Saving sets {i}/{n}', { i: Math.min(i + 8, setEntries.length), n: setEntries.length }));
    await Promise.all(
      setEntries.slice(i, i + 8).map(async ([k, m]) => {
        const meta = {}; // only the fields present in the file; everything else is kept
        if (m.gender) meta.gender = m.gender;
        if ('worlds' in m || 'world' in m) {
          const ws = wl(m);
          setWorlds(meta, ws);
        }
        const role = [m.role, m.vibe, m.look].filter(Boolean).join(', ').slice(0, 120);
        if (role) meta.role = role;
        const nm = String(m.name || m.character || '')
          .trim()
          .slice(0, 20);
        if (nm) meta.charName = nm;
        {
          const st = toTags(m.tags);
          if (st.length) setTagsIn[k] = st;
        }
        if ([...TIERS_CAST, 'generic'].includes(String(m.tier || '').toLowerCase()))
          meta.tier = String(m.tier).toLowerCase();
        const al = (Array.isArray(m.aliases) ? m.aliases : String(m.aliases || '').split(','))
          .map(x => String(x).trim())
          .filter(Boolean)
          .slice(0, 6);
        if (al.length) meta.aliases = al;
        const cover = m.cover && findImg(String(m.cover));
        if (cover && (cover.set || cover.name) === k) meta.cover = cover.id;
        app.setMeta[k] = Object.assign({}, app.setMeta[k] || {}, meta);
        try {
          await SETDOC(k).set(app.setMeta[k]);
          ns++;
        } catch (e) {
          logErr('tags', e);
        }
      }),
    );
  }
  say(T('Applying tags'));
  const touched = new Set();
  for (const [fn, m] of Object.entries(j.backgrounds || {})) {
    const x = findImg(fn);
    if (!x) continue;
    x.kind = 'scene';
    {
      const ws = wl(m);
      if (ws.length) setWorlds(x, ws);
    }
    x.tags = [
      ...new Set(
        [...(m.tags ? toTags(m.tags) : []), m.place, m.time, ...(m.mood ? toTags(m.mood) : [])].filter(Boolean),
      ),
    ].slice(0, 10);
    touched.add(x.id);
    nb++;
  }
  for (const [fn, m] of Object.entries(j.images || {})) {
    const x = findImg(fn);
    if (!x) continue;
    const t = toTags(m.tags || m);
    if (t.length) x.tags = capTags(replaceTags ? t : [...(x.tags || []), ...t]);
    {
      const ws = wl(m);
      if (ws.length) setWorlds(x, ws);
    }
    if (m.emotion && EMOS.includes(m.emotion)) x.emotion = m.emotion;
    touched.add(x.id);
    ni++;
  }
  // a set's own tags go on every frame of that set; in replace mode a frame the file does not list keeps only them
  let nst = 0;
  for (const [k, st] of Object.entries(setTagsIn)) {
    for (const x of app.images) {
      if (x.kind !== 'char' || (x.set || x.name) !== k) continue;
      const own = replaceTags && !touched.has(x.id) ? [] : x.tags || [];
      x.tags = capTags([...st, ...own]);
      touched.add(x.id);
      nst++;
    }
  }
  try {
    await IMGX.flush([...touched], (n, t) => say(T('Saving the image list {i}/{n}', { i: n, n: t })));
  } catch (e) {
    toast(T('Save failed: {err}', { err: e.code || e.message }), 5000);
  }
  say('');
  const miss = Object.keys(j.backgrounds || {}).length + Object.keys(j.images || {}).length - nb - ni;
  toast(
    T('Applied: {sets} sets, {bgs} backgrounds, {imgs} image tags{frames}', {
      sets: ns,
      bgs: nb,
      imgs: ni,
      frames: nst ? T(', {n} {n|frame|frames} got set tags', { n: nst }) : '',
    }) + (miss > 0 ? T(', {n} {n|file|files} not found', { n: miss }) : ''),
    5000,
  );
  renderImages();
}
async function wipeAllImages() {
  try {
    await wipeAllImagesInner();
  } catch (e) {
    toast(T('Error: {err}', { err: (e && (e.code || e.message)) || e }), 5000);
  }
}
// delete one stored file; a failed delete is tried again twice, then skipped
async function deleteAsset(id) {
  for (let i = 0; ; i++) {
    try {
      await platform.assets.delete(id);
      return;
    } catch (e) {
      if (i >= 2) {
        noteIgnored('delete asset', e);
        return;
      }
      await wait(500 * 2 ** i);
    }
  }
}
async function wipeAllImagesInner() {
  let list = [];
  try {
    list = (await platform.assets.list()).assets;
  } catch (e) {
    toast(T("Can't read the asset list: {err}", { err: e.code || e.message }));
    return;
  }
  const total = list.length;
  if (!total && !app.images.length) {
    toast(T('No images to delete'));
    return;
  }
  if (!(await askConfirm(T('Delete all {n} images in storage and the list? This cannot be undone.', { n: total }))))
    return;
  if ((await askPrompt(T('Type {n} to confirm', { n: total }))) !== String(total)) return;
  let n = 0;
  await inParallel(list, 6, async a => {
    setStat(T('Deleting {i}/{n}', { i: ++n, n: total }));
    await deleteAsset(a.id);
  });
  await IMGX.clear().catch(e => noteIgnored('images-view: IMGX.clear', e));
  await inParallel(Object.keys(app.setMeta), 8, k =>
    SETDOC(k)
      .delete()
      .catch(e => noteIgnored('images-view: SETDOC.delete', e)),
  );
  app.images = [];
  app.setMeta = {};
  app.settings.dupMap = {};
  await saveSettings();
  setStat('');
  toast(T('All deleted. You can upload new ones now'));
  renderImages();
}
async function saveManifest() {
  await fillHashes(setStat, T('Scanning')).catch(e => noteIgnored('save list: keep hashes', e));
  const items = app.images.map(x => ({
    shash: x.shash,
    hash: x.hash,
    file: x.file,
    kind: x.kind,
    set: x.set,
    emotion: x.emotion,
    name: x.name,
    tags: x.tags || [],
    worlds: x.worlds || [],
    world: x.world || 'any',
    variant: x.variant || '',
  }));
  // a cover is an id, which a copy doesn't share, so it goes by its file's hash
  const sets = Object.fromEntries(
    Object.entries(app.setMeta).map(([k, m]) => [
      k,
      m.cover ? Object.assign({}, m, { cover: (imgById(m.cover) || {}).shash }) : m,
    ]),
  );
  const data = { kind: 'dice-roguelife-manifest', v: 1, createdAt: nowIso(), items, sets };
  try {
    const old = await findManifestAsset();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    await platform.assets.upload(blob, { type: 'application/json' });
    if (old) await platform.assets.delete(old.asset.id).catch(e => noteIgnored('images-view: ASSETS.delete', e));
    setStat('');
    toast(T('List for copies saved ({n} {n|image|images})', { n: items.length }));
  } catch (e) {
    setStat('');
    toast(T('Save failed: {err}', { err: e.code || e.message }));
  }
}
async function recoverImages() {
  const m = await findManifestAsset();
  if (m) {
    const hit = await restoreFromManifest(m.data, t => setStat(t));
    if (hit) {
      toast(T('Restored {n} {n|image|images} from the list for copies', { n: hit }));
      renderImages();
      return;
    }
  }
  let list;
  try {
    list = (await platform.assets.list()).assets;
  } catch (e) {
    toast(T("Can't read the asset list"));
    return;
  }
  const missing = list.filter(a => !app.images.some(x => x.id === a.id) && /^image\//.test(a.contentType || ''));
  if (!missing.length) {
    toast(T('Nothing to recover'));
    return;
  }
  let n = 0;
  for (const a of missing) {
    setStat(T('Recovering {i}/{n}', { i: ++n, n: missing.length }));
    let portrait = false;
    try {
      const bmp = await createImageBitmap(await (await fetch(a.url || imgUrl(a.id))).blob());
      portrait = bmp.height > bmp.width * 1.1;
    } catch {
      // shape unknown: treated as a landscape picture
    }
    const row = {
      id: a.id,
      kind: portrait ? 'char' : 'scene',
      set: portrait ? 'set' + String(n).padStart(3, '0') : '',
      emotion: 'neutral',
      name: (portrait ? 'char' : 'bg') + String(n).padStart(3, '0'),
      world: 'any',
      tags: [],
      createdAt: a.createdAt || nowIso(),
      recovered: true,
    };
    try {
      await IMGDOC(a.id).set(row);
      app.images.push(row);
    } catch (e) {
      toast(T('Save failed: {err}', { err: e.code || e.message }));
      break;
    }
  }
  setStat('');
  toast(T('Recovered {n} {n|image|images}. Tag them with Auto-sort', { n }));
  renderImages();
}
const imgLabel = x => (x.file && x.file !== x.name ? `${x.name} [${x.file}]` : x.name || x.file || x.id);
const byOldest = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
async function dedupeImages() {
  const say = t => {
    setStat(t);
  };
  await fillHashes(say, T('Scanning'));
  // 1) the very same stored file
  const groups = {};
  for (const x of app.images) {
    const k = x.shash || 'file:' + (x.file || x.name);
    (groups[k] = groups[k] || []).push(x);
  }
  const dups = [];
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    g.sort(byOldest);
    // no hash: the group is only a name match, a guess like a look-alike
    for (const d of g.slice(1))
      dups.push({ d, keep: g[0], why: d.shash ? T('same file') : T('same name'), sure: !!d.shash });
  }
  // 2) the same picture stored again (compressed once more, renamed): compare how they look
  const gone = new Set(dups.map(x => x.d.id));
  const left = app.images.filter(x => !gone.has(x.id));
  const items = [],
    sigs = [];
  const queue = [...left];
  let n = 0;
  const worker = async () => {
    while (queue.length) {
      const x = queue.shift();
      say(T('Comparing looks {i}/{n}', { i: ++n, n: left.length }));
      try {
        sigs.push(await visualSig(await (await fetch(imgUrl(x.id))).blob()));
        items.push(x);
      } catch (e) {
        noteIgnored('dedupe images: look', e);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const g of groupSimilar(sigs)) {
    const [k, ...rest] = g.sort((i, j) => byOldest(items[i], items[j]));
    // a group can chain through a third picture: offer only copies that look like the one kept
    for (const i of rest)
      if (similar(sigs[i], sigs[k])) dups.push({ d: items[i], keep: items[k], why: T('looks the same'), sure: false });
  }
  say('');
  if (!dups.length) {
    toast(T('No duplicate images'));
    return;
  }
  const pairs = dups.map(x => [`${imgLabel(x.d)} (${x.why})`, imgLabel(x.keep)]);
  const sel = await askReview(
    dups.every(x => x.sure)
      ? T(
          'Found {n} duplicate {n|image|images}. Uncheck any you want to keep. The one uploaded first (after →) stays, and past turns point to it.',
          { n: dups.length },
        )
      : T(
          'Found {n} possible duplicate {n|image|images}. Checked ones are deleted. Guesses (looks the same, same name) start unchecked: tap a picture to enlarge it and check the ones that match. The one uploaded first (after →) stays, and past turns point to it.',
          { n: dups.length },
        ),
    pairs,
    // only the same stored file is certain; a guess waits for the player
    { checked: i => dups[i].sure, pics: i => [imgUrl(dups[i].d.id), imgUrl(dups[i].keep.id)] },
  );
  if (!sel) return;
  if (!sel.length) {
    toast(T('Nothing deleted'));
    return;
  }
  const chosen = dups.filter((_, i) => sel.includes(pairs[i]));
  app.settings.dupMap = app.settings.dupMap || {};
  const redirect = new Map(chosen.map(x => [x.d.id, x.keep.id]));
  const final = id => {
    let t = id;
    for (let i = 0; i < 20 && redirect.has(t); i++) t = redirect.get(t);
    return t;
  };
  let done = 0;
  await inParallel(chosen, 6, async ({ d }) => {
    say(T('Cleaning up {i}/{n}', { i: ++done, n: chosen.length }));
    await deleteAsset(d.id);
    app.settings.dupMap[d.id] = final(d.id);
  });
  const removed = new Set(chosen.map(x => x.d.id));
  app.images = app.images.filter(i => !removed.has(i.id));
  await IMGX.dropMany([...removed]).catch(e => noteIgnored('images-view: IMGX.dropMany', e));
  for (const [a, b] of Object.entries(app.settings.dupMap)) if (redirect.has(b)) app.settings.dupMap[a] = final(b);
  await saveSettings();
  say('');
  toast(T('Cleaned up {n} {n|image|images}', { n: done }));
  renderImages();
}
// asks a quick model what each untagged picture is; effect pictures (kind fx, e.g. the dice reveal) keep their kind
async function autoTagAll() {
  const todo = app.images.filter(x => !x.autoTagged && x.kind !== 'fx');
  if (!todo.length) {
    toast(T('No images to auto-sort'));
    return;
  }
  let n = 0;
  for (const x of todo) {
    setStat(T('Sorting {i}/{n}', { i: ++n, n: todo.length }));
    try {
      const blob = await (await fetch(imgUrl(x.id))).blob();
      const r = await platform.sample.json(fillTemplate(pr('autotag'), { emos: EMOS.join('|') }), {
        images: blob,
        modelTier: 'quick',
        cache: false,
      });
      if (r) {
        x.kind = r.kind === 'scene' ? 'scene' : 'char';
        if (x.kind === 'char') {
          x.emotion = EMOS.includes(r.emotion) ? r.emotion : x.emotion || 'neutral';
          x.set = x.set || x.name;
        } else {
          if (r.place)
            x.name =
              String(r.place)
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '')
                .slice(0, 40) || x.name;
          const ws = (Array.isArray(r.worlds) ? r.worlds : []).filter(v => WORLDS.some(w => w.id === v));
          setWorlds(x, ws);
        }
        if (Array.isArray(r.tags) && r.tags.length)
          x.tags = [...new Set([...(x.tags || []), ...r.tags.map(t => String(t).trim()).filter(Boolean)])].slice(0, 10);
        x.autoTagged = true;
        await IMGDOC(x.id).set(x);
      }
    } catch (e) {
      if (e.code === 'rate_limited') {
        toast(T('Try again in a moment'));
        break;
      }
      if (e.code === 'not_granted') {
        toast(T('Claude access is needed'));
        break;
      }
    }
  }
  setStat('');
  renderImages();
}
