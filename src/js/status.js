/* ============ status ============ */
import { $, esc, fmt, toast } from './util.js';
import { locale, N_, T } from './i18n.js';
import { ART_SLOT_LABEL, ART_SLOTS, SKILL_SRC_LABEL } from './enums.js';
import { moneyText, powerGrade, REALMS, STAT_LABEL, SUB_STATS, tierRank } from './data.js';
import { app } from './app.js';
import { itemBonus, statusVisible, TITLES_MAX, titlesOn } from './rules.js';
import { openSheet } from './sheet.js';
import { persist } from './persistence.js';
import { toggleTitle } from './log.js';

// before the awakening the body is felt in steps (pips), not measured
const HP_WORDS = [N_('Dead'), N_('Critical'), N_('Badly hurt'), N_('Hurt'), N_('Good'), N_('Perfect')];
function hpLevel(s) {
  const r = s.hp / s.maxHp;
  return r >= 0.95 ? 5 : r >= 0.7 ? 4 : r >= 0.4 ? 3 : r > 0.15 ? 2 : r > 0 ? 1 : 0;
}
const hpWord = s => T(HP_WORDS[hpLevel(s)]);
const SLOT_LABEL = { weapon: N_('Weapon'), armor: N_('Armor'), accessory: N_('Accessory') };
export function renderStrip() {
  if (!app.state) {
    $('#strip').classList.add('hidden');
    return;
  }
  const s = app.state.stats,
    l = app.state.life,
    M = app.state.murim;
  const turnNo = app.state.turnNo != null ? app.state.turnNo : app.turns.filter(t => t.kind === 'ai').length;
  const el = $('#strip');
  el.classList.remove('hidden');
  const meta = T('Age {age}, {world}, life {life}, turn {turn}', {
    age: s.age,
    world: esc(l.world.name),
    life: app.state.lifeNo,
    turn: turnNo,
  });
  el.innerHTML = `<div class="who">${esc(l.name)} <span class="tier ${l.originTier}">${l.originTier}</span>${M ? `<span class="realm">${T(REALMS[M.realm])}</span>` : ''}<span class="meta">${meta}</span></div>
   <div class="nums">${statusVisible() ? `HP <b>${fmt(s.hp)}</b>/${fmt(s.maxHp)} (${hpWord(s)})&nbsp;&nbsp;${app.state.energy ? `${esc(app.state.energy.name)} <b>${fmt(app.state.energy.cur)}</b>/${fmt(app.state.energy.max)}&nbsp;&nbsp;` : ''}` : `${T('Condition')} <b>${hpWord(s)}</b>&nbsp;&nbsp;`}${!statusVisible() ? '' : M ? T('Inner energy <b>{n}</b> yrs', { n: M.neigong }) : `${T(STAT_LABEL.power)} <b>${fmt(s.power)}</b> (${powerGrade(s.power)})`}</div>
   ${statusVisible() ? `<div class="hp"><i style="width:${Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100))}%"></i></div>` : `<div class="hp pips" aria-label="${T('Condition {word}', { word: hpWord(s) })}">${[1, 2, 3, 4, 5].map(i => `<b class="${i <= hpLevel(s) ? 'on' : ''}"></b>`).join('')}</div>`}`;
}
export function bindStatusStrip() {
  $('#strip').onclick = openStatus;
  $('#strip').onkeydown = e => {
    if (e.key === 'Enter') openStatus();
  };
}
const STATUS_ORNAMENT =
  '<svg class="orn" viewBox="0 0 56 22" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M1 21 C1 8 8 1 21 1 M1 21 C1 14 4 9 9 6 M1 21 C6 21 10 18 12 14 M14 3 c3 -1 6 1 6 4 M4 17 c1 -3 4 -5 7 -5"/><circle cx="22" cy="6" r="1.2" fill="currentColor"/><circle cx="8" cy="20" r="1.2" fill="currentColor"/></svg>';
export function openStatus() {
  if (!app.state) return;
  const l = app.state.life,
    M = app.state.murim;
  const SV = statusVisible();
  const s = SV
    ? app.state.stats
    : Object.fromEntries(Object.entries(app.state.stats).map(([k, v]) => [k, k === 'age' || k === 'gold' ? v : '?']));
  const fmt = x => (x === '?' ? '?' : Number.isFinite(x) ? x.toLocaleString(locale()) : x);
  const fx = app.state.titleFx || {};
  const none = `<p class="sw-empty">${T('None')}</p>`;
  const NEW_TURNS = 10,
    isNew = k => k.at != null && app.state.next - k.at < NEW_TURNS;
  const skills =
    [...app.state.skills]
      .sort((a, b) => isNew(b) - isNew(a) || (b.lv || 1) - (a.lv || 1) || tierRank(a.grade) - tierRank(b.grade))
      .map(
        k =>
          `<div class="sk"><span class="g ${k.grade} tier ${k.grade} grade-flat">${k.grade}</span><div><b>${esc(k.name)}</b>${isNew(k) ? '<span class="newb">NEW</span>' : ''}<span class="src">Lv.${k.lv || 1}${k.cost ? ' · ' + T('Cost {n}%', { n: k.cost }) : ''}${k.src ? ' · ' + esc(T(SKILL_SRC_LABEL[k.src] || k.src)) : ''}</span><p>${esc(k.desc || '')}</p></div></div>`,
      )
      .join('') || none;
  const quests =
    app.state.quests
      .filter(q => q.status === 'active')
      .map(q => `<div class="sw-q"><div><div>${esc(q.title)}</div>${q.note ? `<p>${esc(q.note)}</p>` : ''}</div></div>`)
      .join('') || none;
  openSheet(
    `<div class="sw">${STATUS_ORNAMENT.replace('class="orn"', 'class="orn tl"')}${STATUS_ORNAMENT.replace('class="orn"', 'class="orn tr"')}${STATUS_ORNAMENT.replace('class="orn"', 'class="orn bl"')}${STATUS_ORNAMENT.replace('class="orn"', 'class="orn br"')}<span class="xx" role="button" tabindex="0" aria-label="${T('Close')}" data-close>✕</span>
    <div class="sw-title">${T('Status Window')}</div>
    <div class="sw-head">
      <div><div class="kv"><span>${T('Name')}</span><span>${esc(l.name)} <span class="tier ${l.originTier}">${l.originTier}</span></span></div>
        <div class="kv"><span>${T('Standing')}</span><span>${esc(l.origin)}</span></div>
        ${app.state.clock.place ? `<div class="kv"><span>${T('Place')}</span><span>${esc(app.state.clock.place)}</span></div>` : ''}
        <div class="kv"><span>${T('Title')}</span><span class="ttl">${(() => {
          const on = titlesOn();
          return on.length ? on.map(esc).join(', ') : T('None');
        })()}</span></div></div>
      <div><div class="kv"><span>${T('Life')}</span><span>${app.state.lifeNo}</span></div><div class="kv"><span>${T('Age')}</span><span>${s.age}</span></div><div class="kv"><span>${T('Race')}</span><span>${esc(l.race)}</span></div></div>
    </div>
    <div class="sw-line"></div>
    ${SV ? `<div class="sw-hp"><div class="row"><span>HP</span><span>${fmt(s.hp)} / ${fmt(s.maxHp)}</span></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, (app.state.stats.hp / app.state.stats.maxHp) * 100))}%"></i></div></div>` : `<div class="sw-hp"><div class="row"><span>${T('Condition')}</span><span>${hpWord(app.state.stats)}</span></div><p class="sw-note">${app.settings.statusMode === 'never' ? T('This game shows no numbers. Judge by your body and the story.') : T("You can't see your own numbers yet. An awakening or a measurement opens the status window.")}</p></div>`}
    ${app.state.energy && SV ? `<div class="sw-hp sw-hp-next"><div class="row"><span>${esc(app.state.energy.name)}</span><span>${fmt(app.state.energy.cur)} / ${fmt(app.state.energy.max)}</span></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, (app.state.energy.cur / Math.max(1, app.state.energy.max)) * 100))}%;background:linear-gradient(90deg,#5A8DEE,#B8D0FF)"></i></div></div>` : ''}
    <div class="sw-line"></div>
    <div class="sw-sec"><h4>${T('STATS')}</h4>
      <div class="sw-grid sw-grid-main">
        ${M ? `<div><small>${T('Realm')}</small><b>${T(REALMS[M.realm])}</b></div><div><small>${T('Inner energy')}</small><b>${T('{n} yrs', { n: M.neigong })}</b></div>` : `<div><small>${T(STAT_LABEL.power)}</small><b>${fmt(s.power)}${itemBonus() ? `<span class="sw-sub"> +${fmt(itemBonus())}</span>` : ''}${SV ? ` <span class="sw-sub">(${powerGrade(app.state.stats.power + itemBonus())})</span>` : ''}</b></div>`}
        <div><small>${T(STAT_LABEL.gold)}</small><b>${esc(moneyText(s.gold, app.state.life))}</b></div><div><small>${T(STAT_LABEL.fame)}</small><b>${fmt(s.fame)}</b></div>
      </div>
      <div class="sw-subs">${SUB_STATS.map(([k, label]) => `<span><span class="sw-label">${T(label)}</span><b>${s[k] || 0}</b></span>`).join('')}</div>
    </div>

    ${
      M
        ? `<div class="sw-line"></div><div class="sw-sec"><h4>${T('MURIM')}</h4><dl class="sw-kv"><dt>${T('Next realm')}</dt><dd>${M.realm < REALMS.length - 1 ? T(REALMS[M.realm + 1]) : '-'}</dd><dt>${T('Epithet')}</dt><dd>${esc(M.alias || T('None'))}</dd><dt>${T('Faction')}</dt><dd>${esc(M.faction || T('None'))}${M.rank ? `, ${esc(M.rank)}` : ''}</dd>${M.constitution ? `<dt>${T('Physique')}</dt><dd>${esc(M.constitution)}</dd>` : ''}${ART_SLOTS.filter(
            k => M.arts[k],
          )
            .map(k => `<dt>${T(ART_SLOT_LABEL[k])}</dt><dd>${esc(M.arts[k])}</dd>`)
            .join('')}</dl></div>`
        : ''
    }
    <div class="sw-line"></div>
    <div class="sw-sec"><h4>${T('SKILLS')}</h4><div class="sw-scroll">${skills}</div></div>
    <div class="sw-line"></div>
    ${
      (app.state.items || []).length
        ? `<div class="sw-line"></div><div class="sw-sec"><h4>${T('GEAR')}</h4>${
            (app.state.equipped || []).length
              ? `<div class="sw-scroll">${app.state.equipped
                  .map(n => {
                    const it = app.state.items.find(x => x.name === n) || {};
                    return `<div class="sk"><span class="g ${it.grade || ''} tier ${it.grade || ''} grade-flat">${it.grade || '-'}</span><div><b>${esc(n)}</b><span class="src">${it.slot && SLOT_LABEL[it.slot] ? T(SLOT_LABEL[it.slot]) : ''}${it.power ? ' · +' + it.power : ''}</span><p>${esc(it.note || '')}</p><button class="btn ghost chip-sm sw-uneq" data-uneq="${esc(n)}">${T('Unequip')}</button></div></div>`;
                  })
                  .join('')}</div>`
              : `<p class="sw-empty sw-empty-gear">${T('Nothing equipped')}</p>`
          }
    <h4 class="sw-bag-title">${T('Inventory')}</h4><div class="sw-scroll">${app.state.items.map(it => `<div class="sk"><span class="g ${it.grade || ''} tier ${it.grade || ''} grade-flat">${it.grade || '-'}</span><div><b>${esc(it.name)}</b><span class="src">${it.qty > 1 ? 'x' + it.qty : ''}${(app.state.equipped || []).includes(it.name) ? ' · ' + T('Equipped') : ''}</span><p>${esc(it.note || '')}</p></div></div>`).join('')}</div></div>`
        : ''
    }
    <div class="sw-sec"><h4>${T('QUESTS')}</h4><div class="sw-scroll">${quests}</div></div>
    ${
      Object.keys(app.state.ledger || {}).length
        ? `<div class="sw-line"></div><div class="sw-sec"><h4>${T('LEDGER')}</h4><dl class="sw-kv sw-kv-loose">${Object.entries(
            app.state.ledger,
          )
            .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
            .join('')}</dl></div>`
        : ''
    }
    ${
      (app.state.titles || []).length
        ? (() => {
            const on = titlesOn();
            return `<div class="sw-line"></div><div class="sw-sec"><h4>${T('TITLES')} <span class="sw-count">${T('{n}/{max} active', { n: on.length, max: TITLES_MAX })}</span></h4><div class="sw-chips">${app.state.titles
              .map(t => {
                const act = on.includes(t);
                return `<button type="button" data-title="${esc(t)}" class="sw-chip${act ? ' on' : ''}" title="${esc(fx[t] || '')}">${act ? '● ' : ''}${esc(t)}${fx[t] ? `<span class="sw-fx"> · ${esc(fx[t])}</span>` : ''}</button>`;
              })
              .join(
                '',
              )}</div><p class="sw-note small">${T('Tap to turn one on or off. Up to {max} apply at once', { max: TITLES_MAX })}</p></div>`;
          })()
        : ''
    }
    ${app.state.stateNote ? `<div class="sw-line"></div><div class="sw-sec"><h4>${T('NOW')}</h4><p class="sw-state">${esc(app.state.stateNote)}</p></div>` : ''}
    ${
      app.state.pastLives.length
        ? `<div class="sw-line"></div><div class="sw-sec"><h4>${T('PAST LIVES')}</h4>${app.state.pastLives
            .slice(-3)
            .reverse()
            .map(
              p =>
                `<div class="sw-q sw-q-flat"><div><div>${T('Life {n} {world}, {origin} ({tier}) {score} pts', { n: p.lifeNo, world: esc(p.world), origin: esc(p.origin), tier: esc(p.tier), score: esc(p.score) })}</div><p>${esc(p.epitaph)}</p></div></div>`,
            )
            .join('')}</div>`
        : ''
    }
  </div><div class="row sw-actions"><button class="btn" data-close>${T('Close')}</button></div>`,
    { center: true, wide: true },
  );
  $('#sheetInner')
    .querySelectorAll('[data-title]')
    .forEach(
      b =>
        (b.onclick = async () => {
          if (!toggleTitle(b.dataset.title)) {
            toast(T('You can turn on up to {max} titles', { max: TITLES_MAX }));
            return;
          }
          await persist();
          renderStrip();
          openStatus();
        }),
    );
  $('#sheetInner')
    .querySelectorAll('[data-uneq]')
    .forEach(
      b =>
        (b.onclick = async () => {
          app.state.equipped = (app.state.equipped || []).filter(n => n !== b.dataset.uneq);
          await persist();
          openStatus();
        }),
    ); // taking off is the player's; putting on goes through the narrator
}
