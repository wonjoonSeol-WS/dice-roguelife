// The AI connection controls in ⚙ Settings, the standalone update steps, and the "choose a model" banner.
import { platform } from '../../src/js/db.js';
import { APP_VERSION, RELEASES_URL } from '../../src/js/app.js';
import { openSheet } from '../../src/js/sheet.js';
import { openSettingsSheet } from '../../src/js/settings-sheet.js';
import { N_ } from '../../src/js/i18n.js';
import { $, esc } from '../../src/js/util.js';
import { tr } from './i18n.js';
import { post } from './net.js';
import {
  PROVIDERS,
  activeProfile,
  deleteProfile,
  profileConfig,
  profileHasKey,
  profileNames,
  providerConfig,
  providerUsage,
  saveConnection,
  useProfile,
} from './providers.js';

const PROTOCOLS = [
  ['compatible', N_('OpenAI-compatible')],
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Gemini'],
  ['azure', 'Azure OpenAI'],
  ['perplexity', 'Perplexity Sonar'],
];
// form field -> connection setting
const TEXT = {
  Provider: 'provider',
  Endpoint: 'endpoint',
  Protocol: 'protocol',
  Model: 'model',
  Summary: 'summaryModel',
  Version: 'apiVersion',
};
const NUMBERS = { Max: 'maxTokens', Budget: 'promptBytes', Retries: 'retries' };
const CHECKS = { Stream: 'stream', Json: 'jsonMode', Vision: 'vision' };
const NEW = ''; // the "+ New profile" entry

// <option>s; labels go through tr() unless they are the player's own (profile names)
const options = (list, own = false) =>
  list.map(([v, label]) => `<option value="${esc(v)}">${esc(own ? label : tr(label))}</option>`).join('');

function panelHtml() {
  const check = (id, label) => `<label class="row opt"><input id="${id}" type="checkbox">${label}</label>`;
  const field = (id, label, attrs = '') =>
    `<div class="field"><label for="${id}">${label}</label><input id="${id}" ${attrs}></div>`;
  return `<details class="diag-box" open><summary>${tr('AI connection')}</summary><div class="diag-body provider-fields">
    <div class="field"><label for="apiProfile">${tr('Profile')}</label><select id="apiProfile"></select></div>
    ${field('apiName', tr('Profile name'), 'maxlength="40" autocomplete="off"')}
    <div class="field"><label for="apiProvider">${tr('Provider')}</label><select id="apiProvider">${options(PROVIDERS.map(p => [p.id, p.name]))}</select></div>
    ${field('apiEndpoint', tr('API base URL'), 'type="url"')}
    <div class="field"><label for="apiProtocol">${tr('API protocol')}</label><select id="apiProtocol">${options(PROTOCOLS)}</select></div>
    ${field('apiKey', tr('API key (optional for local models)'), 'type="password" autocomplete="off"')}
    ${field('apiModel', tr('Model ID (Azure: deployment name)'), 'autocomplete="off"')}
    ${field('apiSummary', tr('Summary model ID (optional)'), 'autocomplete="off"')}
    ${field('apiVersion', tr('Azure API version'), 'placeholder="2024-10-21"')}
    ${check('apiVision', tr('Enable image analysis (vision model required)'))}
    <details class="api-advanced"><summary>${tr('Advanced')}</summary>
    <div class="row"><div class="field grow"><label for="apiMax">${tr('Maximum output tokens')}</label><input id="apiMax" type="number" min="64" max="65536"></div><div class="field grow"><label for="apiBudget">${tr('Prompt byte limit')}</label><input id="apiBudget" type="number" min="1000" max="2000000"></div></div>
    <div class="field"><label for="apiRetries">${tr('Retries for rate limits or server errors')}</label><select id="apiRetries">${options(
      ['0', '1', '2'].map(n => [n, n]),
      true,
    )}</select></div>
    ${check('apiStream', tr('Stream replies'))}
    ${check('apiJson', tr('Request JSON mode (only if supported by the model)'))}
    </details>
    <p class="muted">${tr('API calls may cost money. Retries can make extra calls. Fast uses the summary model; Standard and Deep use the narration model. The connection and key are kept on this computer, never in game saves or exports.')}</p>
    <div class="row"><button class="btn" id="apiSave">${tr('Save connection')}</button><button class="btn ghost" id="apiTest">${tr('Test connection (one API call)')}</button><button class="btn ghost" id="apiDelete">${tr('Delete profile')}</button></div>
    <p id="apiStatus" role="status" class="muted"></p>
    <p class="muted">${tr('Session usage: {calls} calls, {input} input tokens, {output} output tokens (when reported)', providerUsage)}</p>
  </div></details>${serverHtml()}`;
}

// ⚙ Settings → Server settings: config.json, read and written through the server
function serverHtml() {
  return `<details class="diag-box"><summary>${tr('Server settings')}</summary><div class="diag-body provider-fields">
    <p class="muted">${tr('Kept in config.json in the app-data folder on this computer, with your saves.')}</p>
    <div class="field"><label for="srvPort">${tr('Port')}</label><input id="srvPort" type="number" min="1" max="65535"></div>
    <div class="field"><label for="srvData">${tr('Data folder (saves, images, AI connection)')}</label><input id="srvData" autocomplete="off" placeholder="${tr('Empty: the app-data folder')}"></div>
    <p class="muted" id="srvNow"></p>
    <div class="field"><label for="srvHosts">${tr('Names for other devices, one per line (Tailscale)')}</label><textarea id="srvHosts" rows="2" placeholder="my-pc.tail1234.ts.net"></textarea></div>
    <p class="muted" id="srvHint"></p>
    <div class="row"><button class="btn" id="srvSave">${tr('Save server settings')}</button></div>
    <p id="srvStatus" role="status" class="muted"></p>
  </div></details>`;
}
async function bindServerSettings(root) {
  const q = id => root.querySelector('#srv' + id);
  // the form shows config.json; the line under it, what this run uses
  const c = await post('/api/server/get', {});
  q('Port').value = c.port;
  q('Data').value = c.dataDir;
  q('Hosts').value = c.hosts.join('\n');
  q('Now').textContent = tr('Now: port {port}, {path}', { port: c.running.port, path: c.running.dataPath });
  q('Hint').textContent = tr(
    'To play on your phone, run tailscale serve --bg {port} on this computer and add the name it prints here.',
    { port: c.running.port },
  );
  q('Save').onclick = async () => {
    const next = {
      port: Number(q('Port').value),
      dataDir: q('Data').value.trim(),
      hosts: q('Hosts').value.split(/\s+/).filter(Boolean),
    };
    try {
      const r = await post('/api/server/set', next);
      q('Status').textContent = r.restart
        ? tr('Saved. Restart npm start to use the new port or data folder.')
        : tr('Saved.');
    } catch (e) {
      q('Status').textContent = e.message;
    }
  };
}

// the host's bindSettings (src/js/host.js): runs each time the settings sheet is drawn
export function bindProviderSettings(root) {
  root.querySelector('.ui-lang-field').insertAdjacentHTML('afterend', panelHtml());
  root.querySelector('#updBtn').onclick = openUpdateSheet;
  syncBanner(); // again in the screen language, which may have just changed
  bindServerSettings(root).catch(e => (root.querySelector('#srvStatus').textContent = e.message));
  const q = id => root.querySelector('#api' + id);
  const status = text => (q('Status').textContent = text);
  let armed = false; // Delete was pressed once
  const azureOnly = () => (q('Version').closest('.field').hidden = q('Protocol').value !== 'azure');
  // the profile list, then the chosen profile's settings (a new one starts from the defaults)
  const show = name => {
    const names = profileNames();
    q('Profile').innerHTML = options([...names.map(n => [n, n]), [NEW, tr('+ New profile')]], true);
    q('Profile').value = name;
    q('Name').value = name || tr('Profile {n}', { n: names.length + 1 });
    const c = profileConfig(name);
    for (const [id, key] of Object.entries({ ...TEXT, ...NUMBERS })) q(id).value = c[key] ?? '';
    for (const [id, key] of Object.entries(CHECKS)) q(id).checked = !!c[key];
    q('Key').value = '';
    q('Key').placeholder = profileHasKey(name) ? tr('Saved on this computer. Leave blank to keep it.') : '';
    q('Delete').disabled = !name;
    q('Delete').textContent = tr('Delete profile');
    armed = false;
    azureOnly();
  };
  // after the profiles changed: show the one in use, and let the game know its limits
  const refresh = async message => {
    show(activeProfile());
    platform.limits = await platform.sample.limits();
    syncBanner();
    status(message);
  };
  const act = job => job().catch(e => status(e.message));
  show(activeProfile());
  // choosing a profile makes it the one that narrates
  q('Profile').onchange = () =>
    act(async () => {
      const name = q('Profile').value;
      if (name === NEW) return show(NEW);
      await useProfile(name);
      await refresh(tr('Using {name}.', { name }));
    });
  q('Delete').onclick = () =>
    act(async () => {
      const name = q('Profile').value;
      if (!armed) {
        armed = true;
        q('Delete').textContent = tr('Delete {name}? Press again.', { name });
        return;
      }
      await deleteProfile(name);
      await refresh('');
    });
  q('Provider').onchange = () => {
    const p = PROVIDERS.find(p => p.id === q('Provider').value);
    q('Endpoint').value = p.endpoint;
    q('Protocol').value = p.protocol;
    q('Key').value = q('Model').value = q('Summary').value = '';
    azureOnly();
  };
  q('Protocol').onchange = azureOnly;
  const save = async () => {
    const next = {};
    for (const [id, key] of Object.entries(TEXT)) next[key] = q(id).value.trim();
    for (const [id, key] of Object.entries(NUMBERS)) next[key] = Number(q(id).value);
    for (const [id, key] of Object.entries(CHECKS)) next[key] = q(id).checked;
    const counts = Object.values(NUMBERS).every(k => Number.isInteger(next[k]) && next[k] >= 0);
    if (!next.model || !next.endpoint || !counts || !next.maxTokens || !next.promptBytes)
      throw new Error(tr('Enter an endpoint, model and valid limits.'));
    await saveConnection(q('Name').value.trim(), q('Profile').value, next, q('Key').value);
    await refresh(tr('Connection saved.'));
  };
  q('Save').onclick = () => act(save);
  q('Test').onclick = () =>
    act(async () => {
      q('Test').disabled = true;
      try {
        await save();
        status(tr('Checking...'));
        const r = await platform.sample('Reply with the single word ok.', { cache: false });
        status(tr('Connected: {model}', { model: r.modelTierApplied }));
      } finally {
        q('Test').disabled = false;
      }
    });
}

async function openUpdateSheet() {
  openSheet(
    `<h3>${tr('Check for updates')}</h3><p>${tr('Standalone version v{version}', { version: esc(APP_VERSION) })}</p><p id="updNow" class="muted">${tr('Checking...')}</p><button class="btn" data-close>${tr('Close')}</button>`,
  );
  const u = await post('/api/update', {}).catch(e => ({ error: e.message }));
  const el = $('#updNow');
  if (!el) return; // closed meanwhile
  // the local server's own failure (stopped, restarted) says what to do; no answer from GitHub is not one
  el.innerHTML = u.error
    ? esc(u.error)
    : !u.latest
      ? tr(
          'Could not reach GitHub to check. See the <a href="{url}" target="_blank" rel="noopener">releases page</a>.',
          {
            url: RELEASES_URL,
          },
        )
      : u.newer
        ? tr(
            'Version v{version} is out: <a href="{url}" target="_blank" rel="noopener">download it</a>, unzip it anywhere and run npm start there. Your saves and AI connection stay in {path}. In a copy of the repository: git pull, npm ci, npm start.',
            { version: esc(u.latest), url: esc(u.url), path: esc(u.dataPath) },
          )
        : tr('This is the latest version.');
}

// the "choose a model" banner, shown while the profile in use has no model
export function syncBanner() {
  const n = $('#noSample');
  if (providerConfig().model) return n.classList.add('hidden');
  n.innerHTML = `${tr('Choose an AI provider and model in Settings to start playing.')} <button class="btn inline-action" id="configureAI">${tr('Settings')}</button>`;
  n.classList.remove('hidden');
  $('#configureAI').onclick = openSettingsSheet;
}
// the screen language can change after the banner is drawn (at start, from the saved settings)
new MutationObserver(() => {
  if (!$('#noSample').classList.contains('hidden')) syncBanner();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
